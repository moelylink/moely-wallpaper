import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import ImageCache from '../src/main/imageCache.js';
import WallpaperCatalog from '../src/main/wallpaperCatalog.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
const imageUrl = 'https://images.example/picture.png';

async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moely-network-'));
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  // 仅测试注入：以回环 HTTP 服务测试真正的 Axios adapter，不放宽生产 HTTPS 校验。
  const cache = new ImageCache(path.join(directory, 'cache'), {
    request: config => axios({ ...config, url: `${baseUrl}/image`, proxy: false }),
    userAgent: 'MoelyWallpaper/network-test'
  });
  await cache.ready;
  t.after(async () => {
    await cache.cancelDownloads();
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { cache, directory, baseUrl };
}

test('real Axios adapter downloads and deduplicates a streamed image', async t => {
  let calls = 0;
  const { cache } = await fixture(t, (request, response) => {
    calls++;
    assert.equal(request.headers['user-agent'], 'MoelyWallpaper/network-test');
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
    response.write(image.subarray(0, 16));
    setImmediate(() => response.end(image.subarray(16)));
  });
  const first = cache.downloadImage(imageUrl, '1');
  const second = cache.downloadImage(imageUrl, '1');
  const [file] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(await fs.readFile(file), image);
  assert.equal(await cache.exists(imageUrl), true);
});

test('real Axios stream interruption leaves no published or temporary image', async t => {
  const { cache } = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
    response.write(image.subarray(0, 16));
    setImmediate(() => response.destroy());
  });
  await assert.rejects(cache.downloadImage(imageUrl, '1'));
  assert.equal(await cache.getLocalImageUrl(imageUrl), null);
  assert.deepEqual(await fs.readdir(cache.cacheDir), []);
});

test('clearing cache aborts an actual in-flight Axios HTTP response', async t => {
  let started;
  let closed;
  const ready = new Promise(resolve => { started = resolve; });
  const ended = new Promise(resolve => { closed = resolve; });
  const { cache } = await fixture(t, (_request, response) => {
    response.on('close', closed);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length });
    response.write(image.subarray(0, 16));
    started();
  });
  const download = cache.downloadImage(imageUrl, '1');
  const rejected = assert.rejects(download, /cancel|abort|取消/i);
  await ready;
  await cache.clearCache();
  await rejected;
  await ended;
  assert.deepEqual(await fs.readdir(cache.cacheDir), ['metadata.json']);
});

test('real Axios redirects still enforce the image HTTPS redirect policy', async t => {
  let destinationReached = false;
  const { cache, baseUrl } = await fixture(t, (request, response) => {
    if (request.url === '/image') {
      response.writeHead(302, { Location: '/destination' });
      response.end();
    } else {
      destinationReached = true;
      response.end(image);
    }
  });
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:/);
  await assert.rejects(cache.downloadImage(imageUrl, '1'), /HTTPS/);
  assert.equal(destinationReached, false);
  assert.deepEqual(await fs.readdir(cache.cacheDir), []);
});

test('real Axios catalog requests retry HTTP failures and recover the saved directory offline', async t => {
  let calls = 0;
  let offline = false;
  const { cache, baseUrl, directory } = await fixture(t, (_request, response) => {
    calls++;
    if (offline || calls === 1) {
      response.writeHead(503);
      response.end('temporarily unavailable');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify([{ id: 1, user: 'artist', category: 'source', original: imageUrl }]));
    }
  });
  const catalog = new WallpaperCatalog(path.join(directory, 'wallpapers.json'), cache, {
    request: (_url, config) => axios.get(`${baseUrl}/catalog`, { ...config, proxy: false }),
    requestTimeout: 1000, retryDelay: 1, totalTimeout: 3000
  });
  const online = await catalog.fetch();
  assert.equal(online.success, true);
  assert.equal(online.offline, false);
  assert.equal(calls, 2);
  offline = true;
  const fallback = await catalog.fetch();
  assert.equal(fallback.success, true);
  assert.equal(fallback.offline, true);
  assert.equal(fallback.wallpapers[0].artist, 'artist');
});

test('real Axios catalog requests obey the shared overall deadline', async t => {
  const { cache, baseUrl, directory } = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('[');
  });
  const catalog = new WallpaperCatalog(path.join(directory, 'wallpapers.json'), cache, {
    request: (_url, config) => axios.get(`${baseUrl}/catalog`, { ...config, proxy: false }),
    requestTimeout: 1000, retryDelay: 1, totalTimeout: 100
  });
  const result = await catalog.fetch();
  assert.equal(result.success, false);
  assert.match(result.error, /超时/);
});
