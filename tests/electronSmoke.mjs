import { app, BrowserWindow, session, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import ImageCache from '../src/main/imageCache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expectedElectronVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/package.json'), 'utf8')).version;
assert.equal(process.versions.electron, expectedElectronVersion);
assert.match(process.versions.electron, /^45\./);
console.log(`Smoke: Electron ${process.versions.electron}, Axios ${axios.VERSION}`);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-smoke-'));
app.setPath('userData', profile);
// Windows 遮挡检测会冻结后台测试窗口；仅测试进程关闭节流，不影响应用沙箱。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
Object.defineProperty(app, 'isPackaged', { get: () => true });
// 生成可辨认的测试位图，不访问图片服务器。
const width = 320;
const height = 200;
const image = Buffer.alloc(54 + width * height * 3);
image.write('BM');
image.writeUInt32LE(image.length, 2);
image.writeUInt32LE(54, 10);
image.writeUInt32LE(40, 14);
image.writeInt32LE(width, 18);
image.writeInt32LE(height, 22);
image.writeUInt16LE(1, 26);
image.writeUInt16LE(24, 28);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const offset = 54 + (y * width + x) * 3;
    image[offset] = 90 + Math.round(120 * x / width);
    image[offset + 1] = 25 + Math.round(60 * y / height);
    image[offset + 2] = 60 + Math.round(150 * y / height);
  }
}
const imageUrl = 'https://images.example/one.bmp';
const previousUrl = 'https://images.example/previous.bmp';
const nextUrl = 'https://images.example/next.bmp';
const neighborImage = Buffer.from(image);
for (let offset = 54; offset < neighborImage.length; offset += 3) {
  neighborImage[offset] = 50;
  neighborImage[offset + 1] = 140;
}
const seedCache = new ImageCache(path.join(profile, 'wallpaper-cache'), {
  request: async () => ({ data: Readable.from([neighborImage]), headers: {} })
});
await seedCache.downloadImage(previousUrl, '20261022');
await seedCache.downloadImage(nextUrl, '20261021');
const expectedNeighborUrl = await seedCache.getLocalImageUrl(previousUrl);
const pendingImage = new PassThrough();
const heldRequests = [];
let released = false;
let failed = false;
let offline = false;
let releaseVersion = app.getVersion();
const errors = [];

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for application state');
}

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on('console-message', event => {
    if (['warning', 'error'].includes(event.level)) errors.push(event.message);
  });
  window.webContents.once('did-finish-load', () => {
    (async () => {
      const evaluate = expression => window.webContents.executeJavaScript(expression);
      await evaluate("localStorage.setItem('moely-wallpaper-tour-completed', 'true')");
      await waitFor(() => evaluate("!!document.querySelector('.carousel-current .wallpaper-image-spinner') && document.querySelector('.carousel-next img')?.style.visibility === 'visible' && Number(getComputedStyle(document.querySelector('.wallpaper-viewer')).opacity) >= 0.99"));
      const loadingState = await evaluate(`(() => {
        const frame = document.querySelector('.carousel-current .wallpaper-image-frame');
        const placeholder = frame.querySelector('.wallpaper-image-placeholder');
        return {
          imageVisibility: frame.querySelector('img').style.visibility,
          background: getComputedStyle(placeholder).backgroundColor,
          frameWidth: frame.getBoundingClientRect().width,
          placeholderWidth: placeholder.getBoundingClientRect().width,
          animation: getComputedStyle(frame.querySelector('.wallpaper-image-spinner')).animationName
        };
      })()`);
      assert.equal(loadingState.imageVisibility, 'hidden');
      assert.equal(loadingState.background, 'rgb(26, 26, 26)');
      assert.equal(loadingState.frameWidth, loadingState.placeholderWidth);
      assert.equal(loadingState.animation, 'wallpaperImageSpin');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const loadingScreenshot = path.join(profile, 'loading.png');
      fs.writeFileSync(loadingScreenshot, (await window.capturePage()).toPNG());
      window.focus();
      await evaluate("document.querySelector('.carousel-next').click()");
      await waitFor(() => evaluate("document.querySelector('.wallpaper-info .info-value')?.textContent === '20261022' && document.querySelector('.carousel-current img')?.style.visibility === 'visible' && !document.querySelector('.wallpaper-container.transitioning')"));
      released = true;
      for (const callback of heldRequests) callback({ cancel: true });
      pendingImage.end(image);
      await waitFor(() => fs.readFileSync(path.join(profile, 'wallpaper-cache/metadata.json'), 'utf8').includes(imageUrl));
      assert.equal(await evaluate("document.querySelector('.wallpaper-info .info-value').textContent"), '20261022');
      assert.equal(await evaluate("document.querySelector('.carousel-current img').getAttribute('src')"), expectedNeighborUrl);
      await evaluate("document.querySelector('.carousel-prev').click()");
      await waitFor(() => evaluate("document.querySelector('.wallpaper-info .info-value')?.textContent === '20261023' && document.querySelector('.carousel-current img')?.style.visibility === 'visible' && !document.querySelector('.wallpaper-container.transitioning')"));
      console.log('Smoke: opaque loading card and cross-date switching verified');
      await waitFor(() => evaluate("!!document.querySelector('.carousel-current img') && document.querySelector('.carousel-current img').src.startsWith('wallpaper-cache:') && document.querySelector('.carousel-current img').naturalWidth > 0"));
      console.log('Smoke: cached image rendered');
      const preferences = window.webContents.getLastWebPreferences();
      assert.equal(preferences.nodeIntegration, false);
      assert.equal(preferences.contextIsolation, true);
      assert.equal(preferences.webSecurity, true);
      assert.equal(preferences.sandbox, true);
      assert.equal(await evaluate('typeof window.require'), 'undefined');
      assert.equal(await evaluate('typeof window.wallpaperAPI.setWallpaper'), 'function');
      assert.equal(await evaluate('typeof window.wallpaperAPI.invoke'), 'undefined');
      assert.equal(await evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content.includes(\"script-src 'self'\")"), true);
      assert.equal((await evaluate("window.wallpaperAPI.openExternal('file:///secret')")).success, false);
      assert.equal((await evaluate("window.wallpaperAPI.setWallpaper('not-in-catalog')")).success, false);
      assert.equal(await evaluate("window.wallpaperAPI.getSettings().then(s => typeof s.autoStart)"), 'boolean');
      releaseVersion = '0.0.1';
      assert.equal((await evaluate('window.wallpaperAPI.checkUpdate()')).hasUpdate, false);
      releaseVersion = app.getVersion();
      assert.equal((await evaluate('window.wallpaperAPI.checkUpdate()')).hasUpdate, false);
      releaseVersion = '999.0.0';
      assert.equal((await evaluate('window.wallpaperAPI.checkUpdate()')).hasUpdate, true);
      releaseVersion = 'invalid version';
      assert.equal((await evaluate('window.wallpaperAPI.checkUpdate()')).success, false);
      releaseVersion = app.getVersion();
      assert.equal(await evaluate("window.open('https://example.com/') === null"), true);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      const initialUrl = window.webContents.getURL();
      const navigation = new Promise(resolve => window.webContents.once('will-navigate', event => {
        setImmediate(() => resolve(event.defaultPrevented));
      }));
      await evaluate("location.href = 'https://example.com/'; undefined");
      assert.equal(await navigation, true);
      assert.equal(window.webContents.getURL(), initialUrl);
      const untrusted = new BrowserWindow({ show: false, webPreferences: {
        preload: path.resolve(__dirname, '../src/main/preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false
      } });
      await untrusted.loadURL('data:text/html,<title>Untrusted test frame</title>');
      assert.equal(await untrusted.webContents.executeJavaScript("window.wallpaperAPI.getSettings().then(() => false, () => true)"), true);
      untrusted.destroy();
      console.log('Smoke: security boundaries verified');
      offline = true;
      window.focus();
      await new Promise(resolve => {
        window.webContents.once('did-finish-load', resolve);
        window.webContents.reload();
      });
      await waitFor(() => evaluate("document.querySelector('.network-warning')?.textContent.includes('上次保存')"));
      await waitFor(() => evaluate("document.querySelector('.carousel-current img')?.naturalWidth > 0"));
      await waitFor(() => evaluate("Number(getComputedStyle(document.querySelector('.wallpaper-viewer')).opacity) >= 0.99"));
      console.log('Smoke: offline fallback rendered');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const shot = await window.capturePage();
      const screenshot = path.join(profile, 'smoke.png');
      fs.writeFileSync(screenshot, shot.toPNG());
      console.log('Smoke: screenshot captured');
      // 只替换测试进程的系统壁纸边界，真实页面仍通过 preload/IPC 完整交互。
      // 绝不在自动化验证中修改用户的系统壁纸。
      let finishSetting;
      ipcMain.removeHandler('set-wallpaper');
      ipcMain.handle('set-wallpaper', (event, id) => {
        assert.equal(event.sender, window.webContents);
        assert.equal(id, '20261023');
        return new Promise(resolve => { finishSetting = resolve; });
      });
      await evaluate("document.querySelector('.set-wallpaper-button').click()");
      await waitFor(() => evaluate("!!document.querySelector('.app-toast--loading')"));
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))");
      await waitFor(() => evaluate("document.querySelector('.wallpaper-info .info-value')?.textContent === '20261022' && !document.querySelector('.wallpaper-container.transitioning')"));
      finishSetting({ success: true });
      await waitFor(() => evaluate("!!document.querySelector('.app-toast--success')"));
      const toastState = await evaluate(`(() => {
        const toast = document.querySelector('.app-toast');
        toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return {
          title: toast.querySelector('.app-toast__title').textContent,
          description: toast.querySelector('.app-toast__description').textContent,
          inInfo: document.querySelector('.wallpaper-info').contains(toast),
          currentId: document.querySelector('.wallpaper-info .info-value').textContent,
          background: getComputedStyle(toast).backgroundColor,
          radius: getComputedStyle(toast).borderRadius
        };
      })()`);
      assert.equal(toastState.title, '壁纸设置成功');
      assert.match(toastState.description, /20261023/);
      assert.equal(toastState.currentId, '20261022');
      assert.equal(toastState.inInfo, false);
      assert.equal(toastState.background, 'rgba(29, 21, 31, 0.97)');
      assert.equal(toastState.radius, '14px');
      await waitFor(() => evaluate("Number(getComputedStyle(document.querySelector('.app-toast')).opacity) >= 0.99"));
      const toastScreenshot = path.join(profile, 'toast.png');
      fs.writeFileSync(toastScreenshot, (await window.capturePage()).toPNG());
      await evaluate("document.querySelector('.app-toast__close').click()");
      await waitFor(() => evaluate("!document.querySelector('.app-toast')"));
      console.log('Smoke: version ordering and independent themed toast verified');

      await evaluate("document.querySelector('.settings-button').click()");
      console.log('Smoke: settings clicked');
      await waitFor(() => evaluate("!!document.querySelector('.clear-cache-button')"));
      const modalState = await evaluate(`new Promise(resolve => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
        document.querySelector('.settings-panel-content').dispatchEvent(event);
        setTimeout(() => resolve({
          currentId: document.querySelector('.wallpaper-info .info-value').textContent,
          wheelPrevented: event.defaultPrevented,
          overflow: getComputedStyle(document.querySelector('.settings-panel-content')).overflowY
        }), 400);
      })`);
      assert.equal(modalState.currentId, '20261022');
      assert.equal(modalState.wheelPrevented, false);
      assert.equal(modalState.overflow, 'auto');
      let navigations = 0;
      window.webContents.on('did-start-navigation', () => navigations++);
      await evaluate("document.querySelector('.clear-cache-button').click()");
      await waitFor(() => evaluate("document.querySelector('.cache-status')?.textContent.includes('缓存清除成功')"));
      assert.equal(navigations, 0);
      assert.deepEqual(fs.readdirSync(path.join(profile, 'wallpaper-cache')), ['metadata.json']);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'wallpaper-cache/metadata.json'), 'utf8')), {});
      // 验证关闭窗口行为设置及托盘隐藏逻辑。
      const initialSettings = await evaluate('window.wallpaperAPI.getSettings()');
      assert.equal(initialSettings.closeBehavior, 'tray');
      await evaluate("document.querySelectorAll('.close-behavior-option')[1].click()");
      await waitFor(async () => (await evaluate('window.wallpaperAPI.getSettings()')).closeBehavior === 'exit');
      await evaluate("document.querySelectorAll('.close-behavior-option')[0].click()");
      await waitFor(async () => (await evaluate('window.wallpaperAPI.getSettings()')).closeBehavior === 'tray');
      window.close();
      await waitFor(() => !window.isVisible());
      assert.equal(window.isDestroyed(), false);
      window.show();
      assert.equal(errors.some(message => /Content Security Policy|Unable to load preload|not allowed to load local resource/i.test(message)), false, errors.join('\n'));
      console.log(JSON.stringify({ success: true, electronVersion: process.versions.electron, axiosVersion: axios.VERSION, sandbox: true, cacheProtocol: true, ipcIsolation: true, navigationBlocked: true, clearWithoutReload: true, offlineCatalog: true, opaqueLoading: true, crossDateSwitching: true, semanticUpdates: true, modalInputIsolation: true, independentToast: true, trayCloseBehavior: true, loadingScreenshot, screenshot, toastScreenshot, profile }, null, 2));
    })().catch(async error => {
      failed = true;
      console.error(error);
      console.error('Renderer messages:', errors);
      if (!window.isDestroyed()) {
        console.error('UI state:', await window.webContents.executeJavaScript(`JSON.stringify({
          id: document.querySelector('.wallpaper-info .info-value')?.textContent,
          classes: document.querySelector('.wallpaper-container')?.className,
          images: [...document.querySelectorAll('.carousel-item')].map(card => ({
            className: card.className, text: card.textContent,
            src: card.querySelector('img')?.getAttribute('src'),
            visible: card.querySelector('img')?.style.visibility,
            complete: card.querySelector('img')?.complete,
            width: card.querySelector('img')?.naturalWidth
          }))
        })`));
      }
    }).finally(() => app.quit());
  });
});

axios.defaults.adapter = async config => {
    let data;
    if (config.url === imageUrl) data = pendingImage;
    else if (config.url.includes('wallpaper.json') && offline) throw new Error('offline fixture');
    else if (config.url.includes('wallpaper.json')) data = [
      { id: '20261023', user: 'Test artist', category: 'Today', original: imageUrl },
      { id: '20261022', user: 'Test artist', category: 'Previous date', original: previousUrl },
      { id: '20261021', user: 'Test artist', category: 'Earlier date', original: nextUrl }
    ];
    else if (config.url.endsWith('notice.md')) data = '';
    else if (config.url.endsWith('version.txt')) data = releaseVersion;
    else throw new Error('Unexpected network request: ' + config.url);
    return { data, status: 200, statusText: 'OK', config,
      headers: config.url === imageUrl ? { 'content-length': String(image.length) } : {} };
  };
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['https://*/*', 'http://*/*'] }, (details, callback) => {
    if (details.url === imageUrl && !released) heldRequests.push(callback);
    else callback({ cancel: true });
  }
));
await import('../src/main/main.js');

const watchdog = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 60000);
app.on('will-quit', () => {
  clearTimeout(watchdog);
  app.exit(failed ? 1 : 0);
});
