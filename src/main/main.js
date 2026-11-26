import { app, BrowserWindow, ipcMain, shell, session, protocol, net, Tray, nativeImage, dialog, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import axios from 'axios';
import { getWallpaper, setWallpaper } from 'wallpaper';
import { spawn } from 'node:child_process';
import ImageCache from './imageCache.js';
import WallpaperCatalog from './wallpaperCatalog.js';
import AppSettings, { VALID_CLOSE_BEHAVIORS, VALID_WALLPAPER_SCALES, normalizeHexColor } from './appSettings.js';
import { decodeEditedImagePayload } from './editedWallpaper.js';
import { isAppUrl, isRequestId, parseExternalUrl } from './security.js';
import { getAppUserAgent } from './userAgent.js';
import { getUpdateInfo } from './updateVersion.js';
import AppUpdater from './appUpdater.js';
import TelemetryClient from './telemetry.js';
import { ensureWindowsCompatibleImage, setWindowsWallpaperViaSystemApi } from './windowsWallpaperFallback.js';
import AutoLaunch from 'auto-launch';

let mainWindow;
let imageCache;
let catalog;
let appSettings;
let appUpdater;
let telemetry;
let appStartedAt = Date.now();
let autoLauncher;
let autoUpdateTimer = null;
let autoUpdateInterval = null;
let tray = null;
let trayWindow = null;
let trayWindowReady = null;
let trayStateCache = null;
let lastTrayStateSignature = '';
let lastTrayBlurAt = 0;
let lastTrayHeight = 172;
let trayMenuOpening = false;
let cacheTask = null;
let wallpaperTask = null;
let clearingCache = false;
let cacheEpoch = 0;
let shuttingDown = false;
let quitAllowed = false;
let initialized = false;
const fetchRequests = new Map();
const NOTICE_MD_URL = 'https://wallpaper.moely.link/notice.md';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = !app.isPackaged;
const entryUrl = isDevelopment ? 'http://localhost:3000/' : pathToFileURL(path.join(__dirname, '../../build/index.html')).href;
const trayEntryUrl = pathToFileURL(path.join(__dirname, 'tray/tray.html')).href;

protocol.registerSchemesAsPrivileged([
  { scheme: 'wallpaper-cache', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

function getWallpaperBinaryPath(platform = process.platform) {
  const binaryName = platform === 'win32'
    ? 'windows-wallpaper-x86-64.exe'
    : (platform === 'darwin' ? 'macos-wallpaper' : '');
  if (!binaryName) return '';
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'wallpaper', 'source', binaryName)
    : path.join(__dirname, '../../node_modules/wallpaper/source', binaryName);
}

function runWallpaperBinary(args, { timeoutMs = 15000, timeoutMessage = 'Wallpaper binary timed out' } = {}) {
  const binaryPath = getWallpaperBinaryPath();
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    return Promise.reject(new Error('Wallpaper binary not found'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args);
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(0, 4096); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4096); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else {
        const hexCode = typeof code === 'number' ? ` (0x${(code >>> 0).toString(16).toUpperCase()})` : '';
        const detail = stderr.trim();
        reject(new Error(`Wallpaper executable failed (${code}${hexCode})${detail ? `: ${detail}` : ''}`));
      }
    });
    child.on('error', spawnError => {
      clearTimeout(timeout);
      reject(spawnError);
    });
  });
}

const setWallpaperCustom = async imagePath => {
  const scale = appSettings?.getWallpaperScale() || 'fill';
  try {
    await setWallpaper(imagePath, { scale });
    return { success: true, method: 'wallpaper-package' };
  } catch (error) {
    if (process.platform === 'win32') {
      const compatiblePath = await ensureWindowsCompatibleImage(imagePath, {
        outputDir: path.join(app.getPath('userData'), 'wallpaper-cache'),
        convertToPng: sourcePath => {
          const image = nativeImage.createFromPath(sourcePath);
          if (image.isEmpty()) throw new Error('无法解码壁纸图片');
          return image.toPNG();
        }
      });
      await setWindowsWallpaperViaSystemApi(compatiblePath, { scale, timeoutMs: 15000 });
      return { success: true, method: 'windows-system-api' };
    }
    if (process.platform !== 'darwin') throw error;
    const args = ['set', path.resolve(imagePath), '--screen', 'all', '--scale', scale];
    await runWallpaperBinary(args, { timeoutMs: 15000, timeoutMessage: '设置壁纸超时' });
    return { success: true, method: 'custom-executable' };
  }
};

function trustedSender(event) {
  return mainWindow && !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    isAppUrl(event.senderFrame.url, entryUrl);
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event) || shuttingDown) throw new Error('Unauthorized IPC request');
    return handler(event, ...args);
  });
}

function cancelFetches() {
  for (const controller of fetchRequests.values()) controller.abort();
  fetchRequests.clear();
}

function cancelWindowWork() {
  cacheEpoch++;
  cancelFetches();
  imageCache?.cancelDownloads().catch(error => console.error('Failed to cancel downloads:', error));
}

function sendImageCached(wallpaper) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
      isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
    mainWindow.webContents.send('image-cached', wallpaper);
  }
}

function sendUpdateStatus(state) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
      isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
    mainWindow.webContents.send('update-status', state);
  }
}

function trustedTraySender(event) {
  return trayWindow && !trayWindow.isDestroyed() &&
    event.sender === trayWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    isAppUrl(event.senderFrame.url, trayEntryUrl);
}

function getDisplayWallpapers() {
  return (catalog?.wallpapers || []).slice(0, 8);
}

async function resolveCurrentWallpaperThumbnail(current) {
  if (!current) return '';
  if (current.isEdited) {
    const editedDir = path.join(app.getPath('userData'), 'edited-wallpaper');
    for (const ext of ['.png', '.jpg']) {
      const candidate = path.join(editedDir, `current${ext}`);
      if (fs.existsSync(candidate)) {
        const thumb = nativeImage.createFromPath(candidate);
        if (!thumb.isEmpty()) return thumb.resize({ width: 360 }).toDataURL();
      }
    }
  }
  await catalog?.ready;
  const catalogItem = catalog?.getById(current.id);
  if (!catalogItem) return '';
  const localUrl = await imageCache?.getLocalImageUrl(catalogItem.originalUrl);
  return localUrl || catalogItem.originalUrl || '';
}

async function getSystemWallpaperPath() {
  try {
    const readViaBinary = async () => {
      const args = process.platform === 'darwin' ? ['get', '--screen', 'main'] : ['get'];
      return runWallpaperBinary(args, { timeoutMs: 1500 }).catch(() => '');
    };
    const isBinaryPreferred = ['win32', 'darwin'].includes(process.platform) && app.isPackaged;
    const reader = isBinaryPreferred
      ? readViaBinary()
      : getWallpaper().catch(error => {
          if (!['win32', 'darwin'].includes(process.platform)) throw error;
          return readViaBinary();
        });
    const currentPath = await Promise.race([
      reader,
      new Promise(resolve => setTimeout(() => resolve(''), 1500))
    ]);
    return typeof currentPath === 'string' ? currentPath.trim() : '';
  } catch {
    return '';
  }
}

function isSameWallpaperPath(actualPath, expectedPath) {
  if (!actualPath || !expectedPath) return false;
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(actualPath) === normalize(expectedPath);
}

const externalThumbCache = new Map();

async function resolveExternalThumbnail(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    const stat = await fs.promises.stat(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    if (externalThumbCache.has(cacheKey)) {
      return externalThumbCache.get(cacheKey);
    }
    const thumb = typeof nativeImage.createThumbnailFromPath === 'function'
      ? await nativeImage.createThumbnailFromPath(filePath, { width: 360, height: 220 })
      : nativeImage.createFromPath(filePath).resize({ width: 360 });
    const dataUrl = thumb && !thumb.isEmpty() ? thumb.toDataURL() : '';
    if (dataUrl) {
      if (externalThumbCache.size >= 8) externalThumbCache.clear();
      externalThumbCache.set(cacheKey, dataUrl);
    }
    return dataUrl;
  } catch {
    return '';
  }
}

async function buildTrayState({ verifyExternal = false } = {}) {
  const current = appSettings?.getCurrentWallpaper() || null;
  const isSwitching = Boolean(wallpaperTask);
  const actualPath = verifyExternal && !isSwitching ? await getSystemWallpaperPath() : '';
  const matchesApplied = isSameWallpaperPath(actualPath, current?.appliedPath);
  const overwrittenByOther = verifyExternal && !isSwitching
    ? Boolean(actualPath && current?.appliedPath && !matchesApplied)
    : Boolean(!isSwitching && trayStateCache?.overwrittenByOther);
  const externalWallpaperName = verifyExternal && !isSwitching
    ? (overwrittenByOther ? path.basename(actualPath) : '')
    : (overwrittenByOther ? (trayStateCache?.externalWallpaperName || '') : '');
  const thumbnailUrl = overwrittenByOther
    ? (actualPath ? await resolveExternalThumbnail(actualPath) : (trayStateCache?.currentWallpaper?.thumbnailUrl || ''))
    : await resolveCurrentWallpaperThumbnail(current);
  return {
    currentWallpaper: current ? { ...current, thumbnailUrl } : null,
    overwrittenByOther,
    externalWallpaperName,
    hasMultiple: getDisplayWallpapers().length > 1,
    isSwitching
  };
}

function getTrayStateSignature(state) {
  return JSON.stringify({
    id: state?.currentWallpaper?.id || '',
    artist: state?.currentWallpaper?.artist || '',
    thumbnailUrl: state?.currentWallpaper?.thumbnailUrl || '',
    overwrittenByOther: Boolean(state?.overwrittenByOther),
    externalWallpaperName: state?.externalWallpaperName || '',
    hasMultiple: Boolean(state?.hasMultiple),
    isSwitching: Boolean(state?.isSwitching)
  });
}

function getTrayPopupBounds(desiredHeight) {
  const width = 224;
  const height = desiredHeight;
  const trayBounds = tray && !tray.isDestroyed() ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.round(trayBounds.width / 2),
    y: trayBounds.y + Math.round(trayBounds.height / 2)
  });
  const area = display.workArea;
  const rawX = trayBounds.width > 0
    ? Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
    : area.x + area.width - width - 12;
  const rawY = trayBounds.height > 0 && trayBounds.y > area.y + area.height / 2
    ? trayBounds.y - height - 6
    : (trayBounds.height > 0 ? trayBounds.y + trayBounds.height + 6 : area.y + area.height - height - 12);
  const x = Math.max(area.x + 8, Math.min(rawX, area.x + area.width - width - 8));
  const y = Math.max(area.y + 8, Math.min(rawY, area.y + area.height - height - 8));
  return { x, y, width, height };
}

function applyTrayStateToUI(state) {
  trayStateCache = state;
  const signature = getTrayStateSignature(state);
  if (signature === lastTrayStateSignature) return;
  lastTrayStateSignature = signature;
  if (!tray || tray.isDestroyed()) return;
  const current = state.currentWallpaper;
  const tooltipLines = ['萌哩壁纸'];
  if (state.overwrittenByOther) {
    tooltipLines.push(`当前桌面壁纸：已被其他应用替换${state.externalWallpaperName ? ` (${state.externalWallpaperName})` : ''}`);
  } else {
    tooltipLines.push(current
      ? `当前桌面壁纸：${current.id}${current.artist ? ` · ${current.artist}` : ''}`
      : '当前桌面壁纸：暂未设置');
  }
  tray.setToolTip(tooltipLines.join('\n'));
  if (trayWindow && !trayWindow.isDestroyed() && !trayWindow.webContents.isDestroyed() &&
      isAppUrl(trayWindow.webContents.getURL(), trayEntryUrl)) {
    const desiredHeight = current?.thumbnailUrl ? 276 : 172;
    if (lastTrayHeight !== desiredHeight) {
      lastTrayHeight = desiredHeight;
      trayWindow.setBounds(getTrayPopupBounds(desiredHeight), false);
    }
    trayWindow.webContents.send('tray-state-updated', state);
  }
}

async function getTrayState() {
  if (!trayStateCache) {
    trayStateCache = await buildTrayState({ verifyExternal: false });
  }
  return trayStateCache;
}

async function refreshTrayState({ verifyExternal = false } = {}) {
  const nextState = await buildTrayState({ verifyExternal });
  applyTrayStateToUI(nextState);
  return nextState;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (initialized && !shuttingDown) createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

async function applyWallpaperById(id) {
  if (clearingCache) return { success: false, error: '正在清除缓存，请稍候' };
  if (wallpaperTask) return { success: false, error: '上次壁纸设置尚未完成' };
  await catalog.ready;
  const wallpaper = catalog.getById(id);
  if (!wallpaper) return { success: false, error: '壁纸不在当前目录中，请重新加载' };
  // 只按主进程目录中的 ID 获取地址，不信任页面传入的 URL 或文件路径。
  if (clearingCache || wallpaperTask) return { success: false, error: '另一个操作正在进行，请稍候' };
  wallpaperTask = (async () => {
    try {
      const imagePath = await imageCache.downloadImage(wallpaper.originalUrl, wallpaper.id);
      const result = await setWallpaperCustom(imagePath);
      const nextCurrent = { id: wallpaper.id, artist: wallpaper.artist || '', isEdited: false, appliedPath: imagePath };
      await appSettings?.setCurrentWallpaper(nextCurrent);
      trayStateCache = {
        currentWallpaper: { ...nextCurrent, thumbnailUrl: await resolveCurrentWallpaperThumbnail(nextCurrent) },
        overwrittenByOther: false,
        externalWallpaperName: '',
        hasMultiple: getDisplayWallpapers().length > 1,
        isSwitching: false
      };
      applyTrayStateToUI(trayStateCache);
      return { success: true, method: result.method };
    } catch (error) {
      return { success: false, error: error.message };
    }
  })().finally(() => {
    wallpaperTask = null;
    refreshTrayState({ verifyExternal: false }).catch(console.error);
  });
  refreshTrayState({ verifyExternal: false }).catch(console.error);
  return wallpaperTask;
}

async function switchWallpaperFromTray(delta) {
  if (shuttingDown || clearingCache || wallpaperTask) return { success: false };
  await catalog.ready;
  const list = getDisplayWallpapers();
  if (list.length < 2) return { success: false };
  const currentId = appSettings?.getCurrentWallpaper()?.id;
  const currentIdx = currentId ? list.findIndex(item => item.id === currentId) : -1;
  const nextIdx = currentIdx === -1
    ? (delta > 0 ? 0 : list.length - 1)
    : (currentIdx + delta + list.length) % list.length;
  const nextWallpaper = list[nextIdx];
  const result = await applyWallpaperById(nextWallpaper.id);
  if (result.success) {
    telemetry?.trackEvent('wallpaper_set', { source: 'tray', scale: appSettings?.getWallpaperScale() || 'fill' });
  }
  if (result.success && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
      isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
    mainWindow.webContents.send('tray-select-wallpaper', nextWallpaper.id);
  }
  if (!result.success) console.error('Failed to switch wallpaper from tray:', result.error);
  return result;
}

async function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  await refreshTrayState({ verifyExternal: false });
}

async function ensureTrayWindow() {
  if (trayWindow && !trayWindow.isDestroyed()) {
    await trayWindowReady;
    return trayWindow;
  }
  trayWindow = new BrowserWindow({
    width: 224,
    height: 172,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      webviewTag: false,
      backgroundThrottling: false
    }
  });
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-redirect']) {
    trayWindow.webContents.on(eventName, event => {
      if (!isAppUrl(event.url, trayEntryUrl)) event.preventDefault();
    });
  }
  trayWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  trayWindow.on('blur', () => {
    lastTrayBlurAt = Date.now();
    if (trayWindow && !trayWindow.isDestroyed()) {
      trayWindow.destroy();
    }
  });
  trayWindow.on('closed', () => {
    trayWindow = null;
    trayWindowReady = null;
    lastTrayHeight = 172;
    lastTrayStateSignature = '';
    if (!shuttingDown && initialized && tray && !tray.isDestroyed()) {
      setTimeout(() => {
        if (!shuttingDown && !trayWindow && initialized && tray && !tray.isDestroyed()) {
          ensureTrayWindow().catch(() => {});
        }
      }, 60);
    }
  });
  trayWindowReady = new Promise(resolve => {
    trayWindow.once('ready-to-show', resolve);
  });
  trayWindow.loadURL(trayEntryUrl);
  await trayWindowReady;
  return trayWindow;
}

async function toggleTrayMenu() {
  if (shuttingDown || !tray || tray.isDestroyed() || trayMenuOpening) return;
  if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  if (Date.now() - lastTrayBlurAt < 200) {
    return;
  }
  trayMenuOpening = true;
  try {
    const popup = await ensureTrayWindow();
    if (shuttingDown || popup.isDestroyed()) return;
    const state = await getTrayState();
    const desiredHeight = state.currentWallpaper?.thumbnailUrl ? 276 : 172;
    lastTrayHeight = desiredHeight;
    popup.setBounds(getTrayPopupBounds(desiredHeight), false);
    const signature = getTrayStateSignature(state);
    if (signature !== lastTrayStateSignature) {
      lastTrayStateSignature = signature;
      popup.webContents.send('tray-state-updated', state);
    }
    popup.show();
    setTimeout(() => {
      if (!shuttingDown) {
        refreshTrayState({ verifyExternal: true }).catch(console.error);
      }
    }, 80);
  } finally {
    trayMenuOpening = false;
  }
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconName = process.platform === 'win32' ? 'favicon.ico' : 'favicon.png';
  const iconPath = path.join(__dirname, '../../icons', iconName);
  let icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  if (process.platform === 'darwin') {
    tray.on('click', () => { toggleTrayMenu().catch(console.error); });
  } else {
    tray.on('click', () => showMainWindow());
  }
  tray.on('right-click', () => { toggleTrayMenu().catch(console.error); });
  updateTrayMenu();
  return tray;
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(workArea.width, Math.max(1000, Math.round(workArea.width * 0.8)));
  const height = Math.min(workArea.height, Math.max(700, Math.round(workArea.height * 0.82)));
  mainWindow = new BrowserWindow({
    width, height, minWidth: 800, minHeight: 600,
    frame: false, transparent: true, titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 9 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: true,
      webviewTag: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-redirect']) {
    mainWindow.webContents.on(eventName, event => {
      if (!isAppUrl(event.url, entryUrl)) event.preventDefault();
    });
  }
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('did-start-navigation', event => {
    if (event.isMainFrame && !event.isSameDocument) cancelWindowWork();
  });
  mainWindow.webContents.on('render-process-gone', cancelWindowWork);
  mainWindow.on('closed', () => {
    const keepInTray = !shuttingDown && appSettings?.getCloseBehavior() === 'tray';
    if (!keepInTray) {
      cancelWindowWork();
    } else {
      cancelFetches();
    }
    mainWindow = null;
    if (!keepInTray && !shuttingDown) {
      app.quit();
    }
  });
  for (const [eventName, flag] of [
    ['enter-full-screen', true],
    ['leave-full-screen', false]
  ]) {
    mainWindow.on(eventName, () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
          isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
        mainWindow.webContents.send('fullscreen-change', flag);
      }
    });
  }
  const syncMaximizedState = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
        isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
      mainWindow.webContents.send('window-maximized-change', mainWindow.isMaximized());
    }
  };
  for (const eventName of ['maximize', 'unmaximize', 'restore', 'resize']) {
    mainWindow.on(eventName, syncMaximizedState);
  }
  mainWindow.loadURL(entryUrl);
  if (isDevelopment) mainWindow.webContents.openDevTools();
}

app.commandLine.appendSwitch('disable-features', 'SkiaGraphite');

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.exit(0);
} else {
  app.whenReady().then(async () => {
    session.defaultSession.setUserAgent(getAppUserAgent());
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    imageCache = new ImageCache(path.join(app.getPath('userData'), 'wallpaper-cache'), { userAgent: getAppUserAgent() });
    catalog = new WallpaperCatalog(path.join(app.getPath('userData'), 'wallpapers.json'), imageCache, { userAgent: getAppUserAgent() });
    appSettings = new AppSettings(path.join(app.getPath('userData'), 'settings.json'));
    await Promise.all([imageCache.ready, catalog.ready, appSettings.ready]);
    await imageCache.cleanupExpiredCache();
    protocol.handle('wallpaper-cache', async request => {
      try {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
        const filePath = await imageCache.resolveCacheUrl(request.url);
        if (!filePath) return new Response(null, { status: 404 });
        const response = await net.fetch(pathToFileURL(filePath).href);
        return new Response(response.body, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), 'Access-Control-Allow-Origin': '*' }
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    autoLauncher = process.platform === 'darwin'
      ? null
      : new AutoLaunch({ name: '萌哩壁纸', path: process.execPath, isHidden: true });
    const isPackagedExecutable = app.isPackaged && !/electron(\.exe)?$/i.test(path.basename(process.execPath));
    telemetry = new TelemetryClient({
      appKey: 'A-US-8264310255',
      appVersion: app.getVersion(),
      locale: app.getLocale() || 'zh-CN',
      isDebug: !app.isPackaged,
      enabled: isPackagedExecutable
    });
    if (!appSettings.hasAutoStartPreference()) {
      if (isPackagedExecutable) {
        await setAutoStartEnabled(true).catch(error => console.error('Failed to enable auto-launch on first run:', error));
      }
      await appSettings.setAutoStart(true);
    }
    appUpdater = new AppUpdater({
      updatesDir: path.join(app.getPath('userData'), 'updates'),
      currentVersion: app.getVersion(),
      userAgent: getAppUserAgent(),
      onStateChange: state => sendUpdateStatus(state),
      launchInstaller: async installerPath => {
        if (process.platform === 'win32') {
          const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
          child.unref();
          app.quit();
        } else if (process.platform === 'darwin') {
          const openError = await shell.openPath(installerPath);
          if (openError) throw new Error(openError);
        } else {
          await shell.openExternal(appUpdater?.downloadUrl || 'https://dl.moely.link/wallpaper/setup.exe');
        }
      }
    });
    initialized = true;
    const isHiddenLaunch = process.argv.includes('--hidden') ||
      (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden);
    const shouldStartSilently = isHiddenLaunch && appSettings.getSilentStart();
    if (!shuttingDown) {
      createTray();
      if (shouldStartSilently) {
        catalog.fetch().then(() => updateTrayMenu()).catch(() => {});
      } else {
        createWindow();
      }
      ensureTrayWindow().catch(() => {});
      appStartedAt = Date.now();
      telemetry.trackEvent('app_started', { silent: shouldStartSilently });
      if (app.isPackaged && appSettings.getAutoUpdate()) {
        autoUpdateTimer = setTimeout(() => {
          appUpdater?.checkAndDownload().catch(() => {});
        }, 5000);
        autoUpdateInterval = setInterval(() => {
          appUpdater?.checkAndDownload().catch(() => {});
        }, 4 * 60 * 60 * 1000);
      }
    }
  }).catch(error => {
    console.error('Failed to start application:', error);
    app.quit();
  });
}

app.on('second-instance', () => {
  showMainWindow();
});
app.on('window-all-closed', () => {
  if (shuttingDown || appSettings?.getCloseBehavior() !== 'tray') {
    if (process.platform !== 'darwin') app.quit();
  }
});
app.on('activate', () => {
  if (!mainWindow && initialized && !shuttingDown) createWindow();
});
app.on('before-quit', event => {
  if (quitAllowed) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  if (autoUpdateTimer) {
    clearTimeout(autoUpdateTimer);
    autoUpdateTimer = null;
  }
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
  }
  appUpdater?.cancel();
  if (trayWindow && !trayWindow.isDestroyed()) {
    trayWindow.destroy();
    trayWindow = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
  cancelFetches();
  const durationSeconds = Math.max(0, Math.round((Date.now() - appStartedAt) / 1000));
  const flushQuitTelemetry = telemetry
    ? Promise.race([
        telemetry.trackEvent('app_quit', { durationSeconds }, { timeoutMs: 1500 }),
        new Promise(resolve => setTimeout(resolve, 1500))
      ])
    : Promise.resolve();
  Promise.allSettled([
    Promise.resolve(imageCache?.cancelDownloads()),
    flushQuitTelemetry
  ]).finally(() => {
    telemetry?.cancel();
    quitAllowed = true;
    app.quit();
  });
});

handle('fetch-wallpapers', async (_event, requestId) => {
  if (!isRequestId(requestId) || fetchRequests.has(requestId) || fetchRequests.size >= 4) {
    throw new Error('Invalid wallpaper request');
  }
  const controller = new AbortController();
  fetchRequests.set(requestId, controller);
  try {
    const result = await catalog.fetch({ signal: controller.signal });
    updateTrayMenu();
    return result;
  } catch (error) {
    if (controller.signal.aborted) return { success: false, cancelled: true, wallpapers: [] };
    throw error;
  } finally {
    if (fetchRequests.get(requestId) === controller) fetchRequests.delete(requestId);
  }
});
ipcMain.on('cancel-fetch-wallpapers', (event, requestId) => {
  if (trustedSender(event) && isRequestId(requestId)) fetchRequests.get(requestId)?.abort();
});

handle('cache-images', async () => {
  if (clearingCache) return [];
  if (!cacheTask) {
    const epoch = cacheEpoch;
    cacheTask = (async () => {
      await catalog.ready;
      const wallpapers = await catalog.withCache();
      if (epoch !== cacheEpoch || clearingCache || shuttingDown) return [];
      return imageCache.batchDownload(wallpapers.filter(wallpaper => !wallpaper.isLocal), wallpaper => {
        if (epoch === cacheEpoch && !clearingCache) sendImageCached(wallpaper);
      });
    })().finally(() => { cacheTask = null; });
  }
  return cacheTask;
});

for (const [channel, action] of [
  ['window-minimize', () => mainWindow.minimize()],
  ['window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()],
  ['window-close', () => mainWindow.close()]
]) {
  ipcMain.on(channel, event => { if (trustedSender(event)) action(); });
}
handle('is-window-maximized', () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()));

handle('set-fullscreen', (_event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid fullscreen value');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(enabled);
  }
  return { success: true, fullscreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) };
});

handle('open-external', async (_event, value) => {
  try {
    const url = parseExternalUrl(value);
    await shell.openExternal(url.href);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
async function isAutoStartEnabled() {
  if (process.platform === 'darwin') {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  }
  return autoLauncher ? autoLauncher.isEnabled() : false;
}

async function setAutoStartEnabled(enabled) {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    return;
  }
  if (!autoLauncher) return;
  if (enabled) await autoLauncher.enable();
  else await autoLauncher.disable();
}

handle('get-settings', async () => {
  const isPackagedExecutable = app.isPackaged && !/electron(\.exe)?$/i.test(path.basename(process.execPath));
  return {
    autoStart: isPackagedExecutable ? await isAutoStartEnabled() : appSettings.getAutoStart(),
    closeBehavior: appSettings.getCloseBehavior(),
    wallpaperScale: appSettings.getWallpaperScale(),
    themeColor: appSettings.getThemeColor(),
    silentStart: appSettings.getSilentStart(),
    autoUpdate: appSettings.getAutoUpdate()
  };
});
handle('set-auto-start', async (_event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid auto-start value');
  await setAutoStartEnabled(enabled);
  await appSettings.setAutoStart(enabled);
  return { success: true };
});
handle('set-silent-start', async (_event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid silent start value');
  await appSettings.setSilentStart(enabled);
  return { success: true, silentStart: enabled };
});
handle('set-auto-update', async (_event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid auto update value');
  await appSettings.setAutoUpdate(enabled);
  if (!enabled) {
    if (autoUpdateTimer) {
      clearTimeout(autoUpdateTimer);
      autoUpdateTimer = null;
    }
    if (autoUpdateInterval) {
      clearInterval(autoUpdateInterval);
      autoUpdateInterval = null;
    }
    appUpdater?.cancel();
  } else if (app.isPackaged && !shuttingDown && !autoUpdateInterval) {
    autoUpdateInterval = setInterval(() => {
      appUpdater?.checkAndDownload().catch(() => {});
    }, 4 * 60 * 60 * 1000);
  }
  return { success: true, autoUpdate: enabled };
});
handle('set-close-behavior', async (_event, behavior) => {
  if (!VALID_CLOSE_BEHAVIORS.has(behavior)) throw new Error('Invalid close behavior');
  await appSettings.setCloseBehavior(behavior);
  return { success: true, closeBehavior: behavior };
});
handle('set-wallpaper-scale', async (_event, scale) => {
  if (!VALID_WALLPAPER_SCALES.has(scale)) throw new Error('Invalid wallpaper scale');
  await appSettings.setWallpaperScale(scale);
  return { success: true, wallpaperScale: scale };
});
handle('set-theme-color', async (_event, color) => {
  const normalized = normalizeHexColor(color);
  if (!normalized) throw new Error('Invalid theme color');
  await appSettings.setThemeColor(normalized);
  return { success: true, themeColor: normalized };
});
ipcMain.handle('tray-get-state', async event => {
  if (!trustedTraySender(event) || shuttingDown) throw new Error('Unauthorized IPC request');
  return getTrayState();
});
ipcMain.handle('tray-switch-wallpaper', async (event, delta) => {
  if (!trustedTraySender(event) || shuttingDown) throw new Error('Unauthorized IPC request');
  return switchWallpaperFromTray(delta === -1 ? -1 : 1);
});
ipcMain.on('tray-show-main', event => {
  if (trustedTraySender(event) && !shuttingDown) {
    if (trayWindow && !trayWindow.isDestroyed()) trayWindow.destroy();
    showMainWindow();
  }
});
ipcMain.on('tray-quit-app', event => {
  if (trustedTraySender(event) && !shuttingDown) {
    if (trayWindow && !trayWindow.isDestroyed()) trayWindow.destroy();
    app.quit();
  }
});

handle('clear-cache', async () => {
  if (clearingCache) return { success: false, error: '正在清除缓存，请稍候' };
  clearingCache = true;
  cacheEpoch++;
  try {
    await imageCache.cancelDownloads();
    await wallpaperTask?.catch(() => {});
    await cacheTask?.catch(() => {});
    const clearedCount = await imageCache.clearCache();
    return { success: true, clearedCount };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    clearingCache = false;
  }
});

handle('fetch-notice', async () => {
  try {
    const response = await axios.get(NOTICE_MD_URL, {
      timeout: 10000, responseType: 'text', maxContentLength: 1024 * 1024,
      headers: { 'User-Agent': getAppUserAgent() }
    });
    const markdown = String(response.data ?? '').trim();
    return markdown ? { markdown, contentHash: crypto.createHash('sha256').update(markdown).digest('hex') } : null;
  } catch (error) {
    console.error('Failed to fetch notice:', error.message);
    return null;
  }
});

handle('check-update', async () => {
  try {
    return await appUpdater.checkForUpdate();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

handle('get-update-state', () => (appUpdater ? appUpdater.getState() : { status: 'idle', hasUpdate: false }));

handle('download-update', async () => (appUpdater
  ? appUpdater.checkAndDownload()
  : { success: false, error: '更新服务未就绪' }));

handle('install-update', async () => {
  if (!appUpdater) return { success: false, error: '更新服务未就绪' };
  try {
    const state = appUpdater.getState();
    const result = await appUpdater.installUpdate();
    if (result?.success) {
      telemetry?.trackEvent('update_installed', {
        fromVersion: state.currentVersion || '',
        toVersion: state.latestVersion || ''
      });
    }
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

handle('set-wallpaper', async (_event, id) => {
  if (!['string', 'number'].includes(typeof id) || String(id).length > 128) throw new Error('Invalid wallpaper ID');
  const result = await applyWallpaperById(id);
  if (result?.success) {
    telemetry?.trackEvent('wallpaper_set', { source: 'main', scale: appSettings?.getWallpaperScale() || 'fill' });
  }
  return result;
});

handle('set-edited-wallpaper', async (_event, payload, wallpaperId) => {
  if (clearingCache) return { success: false, error: '正在清除缓存，请稍候' };
  if (wallpaperTask) return { success: false, error: '上次壁纸设置尚未完成' };
  if (wallpaperId !== undefined && wallpaperId !== null &&
      (!['string', 'number'].includes(typeof wallpaperId) || String(wallpaperId).length > 128)) {
    throw new Error('Invalid wallpaper ID');
  }
  const { buffer, ext } = decodeEditedImagePayload(payload);
  await catalog.ready;
  const wallpaper = wallpaperId != null ? catalog.getById(wallpaperId) : null;
  wallpaperTask = (async () => {
    try {
      const editedDir = path.join(app.getPath('userData'), 'edited-wallpaper');
      await fs.promises.mkdir(editedDir, { recursive: true });
      const targetPath = path.join(editedDir, `current${ext}`);
      await fs.promises.writeFile(targetPath, buffer);
      const result = await setWallpaperCustom(targetPath);
      const nextCurrent = wallpaper
        ? { id: wallpaper.id, artist: wallpaper.artist || '', isEdited: true, appliedPath: targetPath }
        : { id: '已编辑壁纸', artist: '', isEdited: true, appliedPath: targetPath };
      await appSettings?.setCurrentWallpaper(nextCurrent);
      trayStateCache = {
        currentWallpaper: { ...nextCurrent, thumbnailUrl: await resolveCurrentWallpaperThumbnail(nextCurrent) },
        overwrittenByOther: false,
        externalWallpaperName: '',
        hasMultiple: getDisplayWallpapers().length > 1,
        isSwitching: false
      };
      applyTrayStateToUI(trayStateCache);
      telemetry?.trackEvent('wallpaper_set', { source: 'edited', scale: appSettings?.getWallpaperScale() || 'fill' });
      return { success: true, method: result.method };
    } catch (error) {
      return { success: false, error: error.message };
    }
  })().finally(() => {
    wallpaperTask = null;
    refreshTrayState({ verifyExternal: false }).catch(console.error);
  });
  refreshTrayState({ verifyExternal: false }).catch(console.error);
  return wallpaperTask;
});

handle('save-edited-wallpaper', async (_event, payload) => {
  const { buffer, ext } = decodeEditedImagePayload(payload);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '保存编辑后的壁纸',
    defaultPath: `moely-wallpaper-edited${ext}`,
    filters: [
      { name: ext === '.png' ? 'PNG 图片' : 'JPEG 图片', extensions: [ext.slice(1)] },
      { name: '所有图片', extensions: ['png', 'jpg', 'jpeg'] }
    ]
  });
  if (canceled || !filePath) return { success: false, cancelled: true };
  await fs.promises.writeFile(filePath, buffer);
  return { success: true, filePath };
});
