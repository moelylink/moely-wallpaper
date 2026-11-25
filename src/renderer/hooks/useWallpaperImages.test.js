import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import useWallpaperImages from './useWallpaperImages.js';

let root;
let container;
let state;
let images;
const originalImage = window.Image;
const remote = { id: '1', imageUrl: 'https://images.example/picture.png' };

function Fixture({ wallpapers }) {
  state = useWallpaperImages(wallpapers);
  const { preloadImages } = state;
  useEffect(() => preloadImages(wallpapers), [wallpapers, preloadImages]);
  return null;
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  images = [];
  window.Image = class {
    constructor() { images.push(this); }
  };
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  window.Image = originalImage;
  jest.useRealTimers();
});

function failAllAttempts() {
  act(() => images[images.length - 1].onerror());
  act(() => jest.advanceTimersByTime(1000));
  act(() => images[images.length - 1].onerror());
  act(() => jest.advanceTimersByTime(2000));
  act(() => images[images.length - 1].onerror());
  expect(state.imageCache['1']).toBe('error');
}

test('switching from a failed remote URL to a cached URL invalidates the old error', () => {
  act(() => root.render(<Fixture wallpapers={[remote]} />));
  failAllAttempts();
  const cached = { ...remote, imageUrl: 'wallpaper-cache://image/one.png' };
  act(() => root.render(<Fixture wallpapers={[cached]} />));
  expect(state.imageCache['1']).not.toBe('error');
  expect(images[images.length - 1].src).toBe(cached.imageUrl);
  act(() => images[images.length - 1].onload());
  expect(state.imageCache['1']).toBe(cached.imageUrl);
  expect(state.loadingImages['1']).toBe(false);
});

test('manual retry starts a fresh request after all automatic attempts fail', () => {
  act(() => root.render(<Fixture wallpapers={[remote]} />));
  failAllAttempts();
  const count = images.length;
  act(() => state.retryLoadImage(remote));
  expect(images.length).toBe(count + 1);
  act(() => images[images.length - 1].onload());
  expect(state.imageCache['1']).toBe(remote.imageUrl);
});

test('unmount cancels image callbacks and pending retry timers', () => {
  act(() => root.render(<Fixture wallpapers={[remote]} />));
  act(() => images[0].onerror());
  act(() => root.unmount());
  expect(jest.getTimerCount()).toBe(0);
  expect(images[0].onload).toBeNull();
  expect(images[0].onerror).toBeNull();
  root = createRoot(container);
});

test('StrictMode cleanup does not leave a stale pending task blocking the next mount', () => {
  act(() => root.render(<React.StrictMode><Fixture wallpapers={[remote]} /></React.StrictMode>));
  expect(images.length).toBe(2);
  expect(images[0].onload).toBeNull();
  act(() => images[1].onload());
  expect(state.imageCache['1']).toBe(remote.imageUrl);
});

test('late image events from an old URL cannot reset the current cached image state', () => {
  act(() => root.render(<Fixture wallpapers={[remote]} />));
  const oldMarkLoaded = state.markImageLoaded;
  const oldMarkError = state.markImageError;
  const cached = { ...remote, imageUrl: 'wallpaper-cache://image/one.png' };
  act(() => root.render(<Fixture wallpapers={[cached]} />));
  act(() => images[images.length - 1].onload());
  expect(state.imageCache['1']).toBe(cached.imageUrl);
  act(() => oldMarkLoaded(remote));
  act(() => oldMarkError(remote));
  expect(state.imageCache['1']).toBe(cached.imageUrl);
  expect(state.loadingImages['1']).toBe(false);
});
