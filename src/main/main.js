import { app, BrowserWindow, ipcMain, shell, session, protocol, net, Tray, nativeImage, dialog, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import axios from 'axios';
import { setWallpaper } from 'wallpaper';
import { spawn } from 'node:child_process';
import ImageCache from './imageCache.js';
import WallpaperCatalog from './wallpaperCatalog.js';
import AppSettings, { VALID_CLOSE_BEHAVIORS, normalizeHexColor } from './appSettings.js';
import { decodeEditedImagePayload } from './editedWallpaper.js';
import { isAppUrl, isRequestId, parseExternalUrl } from './security.js';
import { getAppUserAgent } from './userAgent.js';
import { getUpdateInfo } from './updateVersion.js';
import AutoLaunch from 'auto-launch';

let mainWindow;
let imageCache;
let catalog;
let appSettings;
let autoLauncher;
let tray = null;
let trayWindow = null;
let trayWindowReady = null;
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

protocol.registerSchemesAsPrivileged([
  { scheme: 'wallpaper-cache', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const setWallpaperCustom = async imagePath => {
  try {
    await setWallpaper(imagePath);
    return { success: true, method: 'wallpaper-package' };
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    const wallpaperExePath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'wallpaper', 'source', 'windows-wallpaper-x86-64.exe')
      : path.join(__dirname, '../../node_modules/wallpaper/source/windows-wallpaper-x86-64.exe');
    if (!fs.existsSync(wallpaperExePath)) throw error;
    return new Promise((resolve, reject) => {
      const child = spawn(wallpaperExePath, ['set', imagePath]);
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('设置壁纸超时'));
      }, 15000);
      child.stdout.resume();
      child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4096); });
      child.on('close', code => {
        clearTimeout(timeout);
        if (code === 0) resolve({ success: true, method: 'custom-executable' });
        else reject(new Error(`Wallpaper executable failed (${code}): ${stderr}`));
      });
      child.on('error', spawnError => {
        clearTimeout(timeout);
        reject(spawnError);
      });
    });
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

function trustedTraySender(event) {
  return trayWindow && !trayWindow.isDestroyed() &&
    event.sender === trayWindow.webContents && event.senderFrame === event.sender.mainFrame &&
    isAppUrl(event.senderFrame.url, entryUrl);
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

async function getTrayState() {
  const current = appSettings?.getCurrentWallpaper() || null;
  const thumbnailUrl = await resolveCurrentWallpaperThumbnail(current);
  return {
    currentWallpaper: current ? { ...current, thumbnailUrl } : null,
    hasMultiple: getDisplayWallpapers().length > 1,
    isSwitching: !!wallpaperTask
  };
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
      await appSettings?.setCurrentWallpaper({ id: wallpaper.id, artist: wallpaper.artist || '', isEdited: false });
      updateTrayMenu();
      return { success: true, method: result.method };
    } catch (error) {
      return { success: false, error: error.message };
    }
  })().finally(() => {
    wallpaperTask = null;
    updateTrayMenu();
  });
  updateTrayMenu();
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
  if (result.success && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
      isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
    mainWindow.webContents.send('tray-select-wallpaper', nextWallpaper.id);
  }
  if (!result.success) console.error('Failed to switch wallpaper from tray:', result.error);
  return result;
}

async function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const state = await getTrayState();
  const current = state.currentWallpaper;
  const tooltipLines = ['萌哩壁纸'];
  tooltipLines.push(current
    ? `当前桌面壁纸：${current.id}${current.artist ? ` · ${current.artist}` : ''}`
    : '当前桌面壁纸：暂未设置');
  tray.setToolTip(tooltipLines.join('\n'));
  if (trayWindow && !trayWindow.isDestroyed() && !trayWindow.webContents.isDestroyed() &&
      isAppUrl(trayWindow.webContents.getURL(), entryUrl)) {
    const desiredHeight = current?.thumbnailUrl ? 276 : 172;
    const [width, height] = trayWindow.getSize();
    if (height !== desiredHeight) trayWindow.setSize(width, desiredHeight, false);
    trayWindow.webContents.send('tray-state-updated', state);
  }
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
      webviewTag: false
    }
  });
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-redirect']) {
    trayWindow.webContents.on(eventName, event => {
      if (!isAppUrl(event.url, entryUrl)) event.preventDefault();
    });
  }
  trayWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  trayWindow.on('blur', () => {
    if (trayWindow && !trayWindow.isDestroyed()) trayWindow.hide();
  });
  trayWindow.on('closed', () => {
    trayWindow = null;
    trayWindowReady = null;
  });
  trayWindowReady = new Promise(resolve => {
    trayWindow.once('ready-to-show', resolve);
  });
  trayWindow.loadURL(`${entryUrl}#tray`);
  await trayWindowReady;
  return trayWindow;
}

async function toggleTrayMenu() {
  if (shuttingDown || !tray || tray.isDestroyed()) return;
  if (trayWindow && !trayWindow.isDestroyed() && trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  const popup = await ensureTrayWindow();
  if (shuttingDown || popup.isDestroyed()) return;
  const state = await getTrayState();
  const desiredHeight = state.currentWallpaper?.thumbnailUrl ? 276 : 172;
  const [width, currentHeight] = popup.getSize();
  if (currentHeight !== desiredHeight) popup.setSize(width, desiredHeight, false);
  const height = desiredHeight;
  const trayBounds = tray.getBounds();
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
  popup.setPosition(x, y, false);
  popup.webContents.send('tray-state-updated', state);
  popup.show();
  popup.focus();
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
  tray.on('click', () => showMainWindow());
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
  mainWindow.on('close', event => {
    if (!shuttingDown && appSettings?.getCloseBehavior() === 'tray') {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    cancelWindowWork();
    mainWindow = null;
  });
  for (const [eventName, flag] of [['enter-full-screen', true], ['leave-full-screen', false]]) {
    mainWindow.on(eventName, () => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed() &&
          isAppUrl(mainWindow.webContents.getURL(), entryUrl)) {
        mainWindow.webContents.send('fullscreen-change', flag);
      }
    });
  }
  mainWindow.loadURL(entryUrl);
  if (isDevelopment) mainWindow.webContents.openDevTools();
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
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
    autoLauncher = new AutoLaunch({ name: '萌哩壁纸', path: process.execPath, isHidden: true });
    initialized = true;
    if (!shuttingDown) {
      createTray();
      createWindow();
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
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!mainWindow && initialized && !shuttingDown) createWindow();
});
app.on('before-quit', event => {
  if (quitAllowed) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  if (trayWindow && !trayWindow.isDestroyed()) {
    trayWindow.destroy();
    trayWindow = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
  cancelFetches();
  Promise.resolve(imageCache?.cancelDownloads()).catch(console.error).finally(() => {
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
  ['window-maximize', () => mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize()],
  ['window-close', () => mainWindow.close()]
]) {
  ipcMain.on(channel, event => { if (trustedSender(event)) action(); });
}

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
handle('get-settings', async () => ({
  autoStart: await autoLauncher.isEnabled(),
  closeBehavior: appSettings.getCloseBehavior(),
  themeColor: appSettings.getThemeColor()
}));
handle('set-auto-start', async (_event, enabled) => {
  if (typeof enabled !== 'boolean') throw new Error('Invalid auto-start value');
  if (enabled) await autoLauncher.enable();
  else await autoLauncher.disable();
  return { success: true };
});
handle('set-close-behavior', async (_event, behavior) => {
  if (!VALID_CLOSE_BEHAVIORS.has(behavior)) throw new Error('Invalid close behavior');
  await appSettings.setCloseBehavior(behavior);
  return { success: true, closeBehavior: behavior };
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
    trayWindow?.hide();
    showMainWindow();
  }
});
ipcMain.on('tray-quit-app', event => {
  if (trustedTraySender(event) && !shuttingDown) {
    trayWindow?.hide();
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
    const response = await axios.get('https://wallpaper.moely.link/app/version.txt', {
      timeout: 10000, maxContentLength: 4096,
      headers: { 'User-Agent': getAppUserAgent() }
    });
    const update = getUpdateInfo(app.getVersion(), response.data);
    return {
      success: true, ...update,
      updateUrl: 'https://wallpaper.moely.link/app/setup.exe'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

handle('set-wallpaper', async (_event, id) => {
  if (!['string', 'number'].includes(typeof id) || String(id).length > 128) throw new Error('Invalid wallpaper ID');
  return applyWallpaperById(id);
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
      await appSettings?.setCurrentWallpaper(wallpaper
        ? { id: wallpaper.id, artist: wallpaper.artist || '', isEdited: true }
        : { id: '已编辑壁纸', artist: '', isEdited: true });
      updateTrayMenu();
      return { success: true, method: result.method };
    } catch (error) {
      return { success: false, error: error.message };
    }
  })().finally(() => {
    wallpaperTask = null;
    updateTrayMenu();
  });
  updateTrayMenu();
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
