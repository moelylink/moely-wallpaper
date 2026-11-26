import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useWallpaperImages from '../hooks/useWallpaperImages.js';

jest.mock('../hooks/useWallpaperImages.js');

let root;
let container;
let WallpaperViewer;
let props;
const api = { setWallpaper: jest.fn(), clearCache: jest.fn() };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  window.wallpaperAPI = api;
  api.setWallpaper.mockResolvedValue({ success: false, error: 'system denied' });
  api.clearCache.mockResolvedValue({ success: true, clearedCount: 1 });
  WallpaperViewer = require('./WallpaperViewer.js').default;
  useWallpaperImages.mockReturnValue({
    imageCache: {}, loadingImages: {}, preloadImages: jest.fn(),
    retryLoadImage: jest.fn(), markImageLoaded: jest.fn(), markImageError: jest.fn()
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    wallpapers: [{ id: '1', imageUrl: 'https://images.example/one.png', artist: 'artist' }],
    showSettings: true, setShowSettings: jest.fn(), autoStart: false,
    handleAutoStartChange: jest.fn(), closeBehavior: 'tray',
    handleCloseBehaviorChange: jest.fn(), onCacheCleared: jest.fn()
  };
  act(() => root.render(<WallpaperViewer {...props} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('automatic wallpaper failure pauses the mode instead of retrying every second', async () => {
  act(() => root.render(<WallpaperViewer {...props} showSettings={false} />));
  act(() => container.querySelector('.auto-wallpaper-button').click());
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(document.querySelector('.app-toast').textContent).toContain('已暂停');
  expect(container.querySelector('.auto-wallpaper-button').textContent).toContain('关');
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(window.wallpaperAPI.setWallpaper).toHaveBeenCalledTimes(1);
  expect(window.wallpaperAPI.setWallpaper).toHaveBeenCalledWith('1');
});

test('clearing cache updates parent state without scheduling a page reload', async () => {
  await act(async () => container.querySelector('.clear-cache-button').click());
  expect(props.onCacheCleared).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.app-toast--success').textContent).toContain('已删除 1 个文件');
});

test('unmount cancels status and interaction timers', async () => {
  api.setWallpaper.mockResolvedValue({ success: true });
  await act(async () => container.querySelector('.set-wallpaper-button').click());
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  act(() => root.unmount());
  expect(jest.getTimerCount()).toBe(0);
  root = createRoot(container);
});

test('loading cards hide image pixels and show the same full-size spinner placeholder', () => {
  const images = useWallpaperImages.mock.results[0].value;
  useWallpaperImages.mockReturnValue({ ...images, imageCache: {}, loadingImages: { '1': true } });
  act(() => root.render(<WallpaperViewer {...props} />));
  const current = container.querySelector('.carousel-current');
  expect(current.querySelector('.wallpaper-image-placeholder .wallpaper-image-spinner')).not.toBeNull();
  expect(current.querySelector('img').style.visibility).toBe('hidden');
});

test('a different wallpaper gets a fresh image element rather than reusing old pixels', () => {
  const previousImage = container.querySelector('.carousel-current img');
  const wallpapers = [{ id: '2', imageUrl: 'https://images.example/another-date.png', artist: 'other' }];
  act(() => root.render(<WallpaperViewer {...props} wallpapers={wallpapers} />));
  const nextImage = container.querySelector('.carousel-current img');
  expect(nextImage).not.toBe(previousImage);
  expect(nextImage.style.visibility).toBe('hidden');
  expect(nextImage.getAttribute('src')).toBe(wallpapers[0].imageUrl);
});

const secondWallpaper = { id: '2', imageUrl: 'https://images.example/two.png', artist: 'second artist' };
const currentId = () => container.querySelector('.wallpaper-info .info-value').textContent;
const renderViewer = overrides => act(() => root.render(
  <WallpaperViewer {...props} wallpapers={[props.wallpapers[0], secondWallpaper]} {...overrides} />
));

test('settings block keyboard and wheel navigation without swallowing panel scrolling', () => {
  renderViewer({ showSettings: true });
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  act(() => window.dispatchEvent(key));
  act(() => container.querySelector('.settings-panel-content').dispatchEvent(wheel));
  act(() => jest.advanceTimersByTime(1000));
  expect(currentId()).toBe('1');
  expect(key.defaultPrevented).toBe(false);
  expect(wheel.defaultPrevented).toBe(false);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

test('opening settings cancels a wheel debounce that was queued before the modal opened', () => {
  renderViewer({ showSettings: false });
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  act(() => container.querySelector('.carousel-3d-container').dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true);
  renderViewer({ showSettings: true });
  act(() => jest.advanceTimersByTime(500));
  expect(currentId()).toBe('1');
});

test('keyboard and wheel navigation resume after closing settings', () => {
  renderViewer({ showSettings: true });
  renderViewer({ showSettings: false });
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('2');
  act(() => container.querySelector('.carousel-3d-container').dispatchEvent(
    new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
  ));
  act(() => jest.advanceTimersByTime(350));
  expect(currentId()).toBe('1');
});

test('other app dialogs block background navigation as well', () => {
  renderViewer({ showSettings: false, interactionBlocked: true });
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('1');
});

test('form controls retain their native arrow key behavior', () => {
  renderViewer({ showSettings: false });
  const input = document.createElement('input');
  container.appendChild(input);
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(key));
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('1');
  expect(key.defaultPrevented).toBe(false);
});

test('opening a modal cancels pending automatic wallpaper work and closing it resumes', async () => {
  renderViewer({ showSettings: false });
  act(() => container.querySelector('.auto-wallpaper-button').click());
  renderViewer({ showSettings: true });
  await act(async () => jest.advanceTimersByTime(5000));
  expect(api.setWallpaper).not.toHaveBeenCalled();
  renderViewer({ showSettings: false });
  await act(async () => jest.advanceTimersByTime(1000));
  expect(api.setWallpaper).toHaveBeenCalledTimes(1);
});

test.each([
  { success: true, title: '壁纸设置成功', type: 'success' },
  { success: false, error: 'system denied', title: '壁纸设置失败', type: 'error' }
])('a $type result stays tied to the original wallpaper in an independent toast', async result => {
  let complete;
  api.setWallpaper.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  renderViewer({ showSettings: false });
  await act(async () => container.querySelector('.set-wallpaper-button').click());
  expect(document.querySelector('.app-toast--loading')).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('2');
  await act(async () => complete(result));
  const toast = document.querySelector(`.app-toast--${result.type}`);
  expect(toast.querySelector('.app-toast__title').textContent).toBe(result.title);
  expect(toast.querySelector('.app-toast__description').textContent).toContain('壁纸 1');
  expect(toast.querySelector('.app-toast__description').textContent).not.toContain('second artist');
  expect(container.contains(toast)).toBe(false);
  expect(container.querySelector('.wallpaper-info .status-text')).toBeNull();
  expect(currentId()).toBe('2');
});

test('close behavior setting renders options and notifies parent on change', () => {
  renderViewer({ showSettings: true, closeBehavior: 'tray' });
  const options = [...container.querySelectorAll('.close-behavior-option')];
  expect(options.map(button => button.textContent)).toEqual(['缩小到托盘', '退出程序']);
  expect(options[0].getAttribute('aria-checked')).toBe('true');
  expect(options[1].getAttribute('aria-checked')).toBe('false');
  act(() => options[1].click());
  expect(props.handleCloseBehaviorChange).toHaveBeenCalledWith('exit');
});

test('silent start toggle appears only when autoStart is enabled', () => {
  renderViewer({ showSettings: true, autoStart: false, silentStart: false });
  expect(container.querySelector('input[aria-label="静默启动"]')).toBeNull();
  const handleSilentStartChange = jest.fn();
  renderViewer({ showSettings: true, autoStart: true, silentStart: false, handleSilentStartChange });
  const toggle = container.querySelector('input[aria-label="静默启动"]');
  expect(toggle).not.toBeNull();
  expect(toggle.checked).toBe(false);
  act(() => toggle.click());
  expect(handleSilentStartChange).toHaveBeenCalledWith(true);
});

test('navigating left and right assigns directional slide classes and right-entry keyframes exist', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, 'WallpaperViewer.css'), 'utf8');
  expect(css).toMatch(/\.carousel-item\.fast-slide-to-center-from-right\s*\{\s*animation:\s*fastSlideToCenterFromRight\b/);
  expect(css).toMatch(/@keyframes fastSlideToCenterFromRight\s*\{[\s\S]*?translateX\(30vw\)/);
  expect(css).toMatch(/\.carousel-item\.slide-to-center-from-right\s*\{\s*animation:\s*slideToCenterFromRight\b/);
  expect(css).toMatch(/@keyframes slideToCenterFromRight\s*\{[\s\S]*?translateX\(40vw\)/);

  const thirdWallpaper = { id: '3', imageUrl: 'https://images.example/three.png', artist: 'third artist' };
  renderViewer({ showSettings: false, wallpapers: [props.wallpapers[0], secondWallpaper, thirdWallpaper] });

  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  act(() => jest.advanceTimersByTime(30));
  expect(currentId()).toBe('2');
  expect(container.querySelector('.carousel-current').className).toContain('fast-slide-to-center-from-right');
  expect(container.querySelector('.carousel-prev').className).toContain('fast-slide-to-left-from-center');
  act(() => jest.advanceTimersByTime(260));
  expect(container.querySelector('.carousel-current').className).not.toContain('fast-slide-to-center-from-right');

  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
  act(() => jest.advanceTimersByTime(30));
  expect(currentId()).toBe('1');
  expect(container.querySelector('.carousel-current').className).toContain('fast-slide-to-center-from-left');
  expect(container.querySelector('.carousel-next').className).toContain('fast-slide-to-right-from-center');
  act(() => jest.advanceTimersByTime(260));
  expect(container.querySelector('.carousel-current').className).not.toContain('fast-slide-to-center-from-left');
});

test('theme color setting renders swatches, reset button and notifies parent on change', () => {
  const handleThemeColorChange = jest.fn();
  renderViewer({ showSettings: true, themeColor: '#2f8cff', handleThemeColorChange });
  const swatches = [...container.querySelectorAll('.theme-swatch')];
  expect(swatches.length).toBeGreaterThan(1);
  expect(container.querySelector('.theme-color-hex').textContent).toBe('#2F8CFF');
  act(() => swatches[0].click());
  expect(handleThemeColorChange).toHaveBeenCalledWith('#ff00b4');
  act(() => container.querySelector('.theme-reset-btn').click());
  expect(handleThemeColorChange).toHaveBeenCalledWith('#ff00b4');
});

test('opening wallpaper editor modal blocks background navigation until closed', () => {
  renderViewer({ showSettings: false });
  act(() => container.querySelector('.carousel-current .edit-wallpaper-button').click());
  expect(container.querySelector('.wallpaper-editor-modal')).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('1');
  act(() => container.querySelector('.wallpaper-editor-close').click());
  expect(container.querySelector('.wallpaper-editor-modal')).toBeNull();
});

test('fullscreen preview overlay shows wallpaper without calling setWallpaper and supports navigation and Escape exit', () => {
  api.setWallpaper.mockClear();
  renderViewer({ showSettings: false });
  act(() => container.querySelector('.carousel-current .preview-wallpaper-button').click());
  const overlay = document.querySelector('.wallpaper-preview-overlay');
  expect(overlay).not.toBeNull();
  expect(overlay.parentElement).toBe(document.body);
  expect(overlay.querySelector('.preview-wallpaper-image').className).toContain('fit-cover');

  const buttons = [...overlay.querySelectorAll('.preview-action-btn')];
  const containBtn = buttons.find(btn => btn.textContent === '适应');
  act(() => containBtn.click());
  expect(overlay.querySelector('.preview-wallpaper-image').className).toContain('fit-contain');

  expect(overlay.querySelector('.preview-desktop-mock')).not.toBeNull();
  expect(overlay.querySelectorAll('.mock-desktop-icon').length).toBeGreaterThan(0);
  const desktopMockBtn = buttons.find(btn => btn.textContent === '桌面模拟');
  act(() => desktopMockBtn.click());
  expect(overlay.querySelector('.preview-desktop-mock')).toBeNull();

  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  expect(currentId()).toBe('2');

  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(document.querySelector('.wallpaper-preview-overlay')).toBeNull();
  expect(api.setWallpaper).not.toHaveBeenCalled();
});

test('left and right nav buttons switch wallpapers', () => {
  renderViewer({ showSettings: false });
  act(() => container.querySelector('.nav-button-right').click());
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('2');
  act(() => container.querySelector('.nav-button-left').click());
  act(() => jest.advanceTimersByTime(300));
  expect(currentId()).toBe('1');
});
