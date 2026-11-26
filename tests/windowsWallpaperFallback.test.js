import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getWindowsScaleRegistryValues,
  ensureWindowsCompatibleImage,
  setWindowsWallpaperViaSystemApi
} from '../src/main/windowsWallpaperFallback.js';

test('getWindowsScaleRegistryValues maps supported scale modes and defaults unknown values to fill', () => {
  assert.deepEqual(getWindowsScaleRegistryValues('fill'), { style: '10', tile: '0' });
  assert.deepEqual(getWindowsScaleRegistryValues('fit'), { style: '6', tile: '0' });
  assert.deepEqual(getWindowsScaleRegistryValues('stretch'), { style: '2', tile: '0' });
  assert.deepEqual(getWindowsScaleRegistryValues('center'), { style: '0', tile: '0' });
  assert.deepEqual(getWindowsScaleRegistryValues('tile'), { style: '0', tile: '1' });
  assert.deepEqual(getWindowsScaleRegistryValues('span'), { style: '22', tile: '0' });
  assert.deepEqual(getWindowsScaleRegistryValues('unknown'), { style: '10', tile: '0' });
});

test('ensureWindowsCompatibleImage keeps native extensions untouched without invoking converter', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moely-win-native-'));
  try {
    let called = false;
    for (const ext of ['.jpg', '.jpeg', '.png', '.bmp']) {
      const file = path.join(dir, `sample${ext}`);
      const resolved = await ensureWindowsCompatibleImage(file, {
        outputDir: dir,
        convertToPng: () => {
          called = true;
          return Buffer.from([1, 2, 3]);
        }
      });
      assert.equal(resolved, path.resolve(file));
    }
    assert.equal(called, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('ensureWindowsCompatibleImage converts unsupported formats to PNG and rejects empty output', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moely-win-convert-'));
  try {
    const webpPath = path.join(dir, 'wallpaper.webp');
    const convertedPath = await ensureWindowsCompatibleImage(webpPath, {
      outputDir: path.join(dir, 'out'),
      convertToPng: src => {
        assert.equal(src, path.resolve(webpPath));
        return Buffer.from('fake-png-bytes');
      }
    });
    assert.equal(convertedPath, path.join(dir, 'out', 'fallback-wallpaper.png'));
    assert.equal(await fs.readFile(convertedPath, 'utf8'), 'fake-png-bytes');

    await assert.rejects(
      () => ensureWindowsCompatibleImage(path.join(dir, 'broken.avif'), {
        outputDir: path.join(dir, 'out'),
        convertToPng: () => Buffer.alloc(0)
      }),
      /Failed to convert wallpaper image to PNG/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('setWindowsWallpaperViaSystemApi passes resolved path and scale registry values via environment', async () => {
  let captured = null;
  await setWindowsWallpaperViaSystemApi('C:\\wallpapers\\test image.png', {
    scale: 'fit',
    timeoutMs: 5000,
    execFileAsync: async (command, args, options) => {
      captured = { command, args, options };
    }
  });
  assert.equal(captured.command, 'powershell.exe');
  assert.deepEqual(captured.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(captured.args[3], /SystemParametersInfoW/);
  assert.equal(captured.options.timeout, 5000);
  assert.equal(captured.options.windowsHide, true);
  assert.equal(captured.options.env.MOELY_WALLPAPER_PATH, path.resolve('C:\\wallpapers\\test image.png'));
  assert.equal(captured.options.env.MOELY_WALLPAPER_STYLE, '6');
  assert.equal(captured.options.env.MOELY_WALLPAPER_TILE, '0');
});
