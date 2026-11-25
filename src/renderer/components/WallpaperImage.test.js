import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WallpaperImage from './WallpaperImage.js';

let root;
let container;
let props;
const remote = { id: '20261023', imageUrl: 'https://images.example/today.png', artist: 'artist' };

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
  props = { wallpaper: remote, error: false, onLoad: jest.fn(), onError: jest.fn(), onRetry: jest.fn() };
  act(() => root.render(<WallpaperImage {...props} />));
});

afterEach(() => act(() => root.unmount()));

test('placeholder stays visible until the current image has decoded', async () => {
  const image = container.querySelector('img');
  let resolveDecode;
  image.decode = jest.fn(() => new Promise(resolve => { resolveDecode = resolve; }));
  act(() => image.dispatchEvent(new Event('load')));
  expect(image.style.visibility).toBe('hidden');
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(props.onLoad).not.toHaveBeenCalled();
  await act(async () => resolveDecode());
  expect(image.style.visibility).toBe('visible');
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(props.onLoad).toHaveBeenCalledWith(remote);
});

test('late decoding from another date cannot reveal or mark the new picture loaded', async () => {
  const oldImage = container.querySelector('img');
  let resolveDecode;
  oldImage.decode = jest.fn(() => new Promise(resolve => { resolveDecode = resolve; }));
  act(() => oldImage.dispatchEvent(new Event('load')));
  const next = { ...remote, id: '20261022', imageUrl: 'https://images.example/yesterday.png' };
  act(() => root.render(<WallpaperImage {...props} wallpaper={next} />));
  const newImage = container.querySelector('img');
  expect(newImage).not.toBe(oldImage);
  await act(async () => resolveDecode());
  expect(newImage.style.visibility).toBe('hidden');
  expect(props.onLoad).not.toHaveBeenCalled();
  await act(async () => newImage.dispatchEvent(new Event('load')));
  expect(newImage.style.visibility).toBe('visible');
  expect(props.onLoad).toHaveBeenCalledTimes(1);
  expect(props.onLoad).toHaveBeenCalledWith(next);
});

test('cached URL replacement hides the old picture until the new source is ready', async () => {
  await act(async () => container.querySelector('img').dispatchEvent(new Event('load')));
  const oldImage = container.querySelector('img');
  const cached = { ...remote, imageUrl: 'wallpaper-cache://image/today.png' };
  act(() => root.render(<WallpaperImage {...props} wallpaper={cached} />));
  const image = container.querySelector('img');
  expect(image).not.toBe(oldImage);
  expect(image.style.visibility).toBe('hidden');
  expect(container.querySelector('.wallpaper-image-spinner')).not.toBeNull();
});

test('decode errors show an error card and retry returns to a spinner without bubbling', async () => {
  const image = container.querySelector('img');
  image.decode = jest.fn().mockRejectedValue(new Error('invalid image'));
  await act(async () => image.dispatchEvent(new Event('load')));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(props.onError).toHaveBeenCalledWith(remote);
  const bubbled = jest.fn();
  const parent = document.createElement('div');
  parent.appendChild(container);
  parent.addEventListener('click', bubbled);
  act(() => container.querySelector('.retry-button-small').click());
  expect(props.onRetry).toHaveBeenCalledWith(remote);
  expect(bubbled).not.toHaveBeenCalled();
  expect(container.querySelector('.wallpaper-image-spinner')).not.toBeNull();
});

test('a successful background retry can recover the same URL after an error', async () => {
  act(() => container.querySelector('img').dispatchEvent(new Event('error')));
  act(() => root.render(<WallpaperImage {...props} error />));
  expect(container.querySelector('img')).toBeNull();
  act(() => root.render(<WallpaperImage {...props} error={false} />));
  const image = container.querySelector('img');
  expect(image).not.toBeNull();
  await act(async () => image.dispatchEvent(new Event('load')));
  expect(image.style.visibility).toBe('visible');
});
