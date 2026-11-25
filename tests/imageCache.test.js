import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import ImageCache from '../src/main/imageCache.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');
const url = 'https://images.example/picture.png';

async function fixture(t, request) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moely-cache-'));
  const cache = new ImageCache(dir, { request });
  await cache.ready;
  t.after(async () => {
    await cache.cancelDownloads();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return cache;
}

function response(data = image) {
  return { data: Readable.from([data]), headers: { 'content-length': String(data.length) } };
}

test('same URL shares one download and publishes only a complete file', async t => {
  let calls = 0;
  const stream = new PassThrough();
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const cache = await fixture(t, async () => {
    calls++;
    started();
    return { data: stream, headers: { 'content-length': String(image.length) } };
  });
  const first = cache.downloadImage(url, '1');
  const second = cache.downloadImage(url, '1');
  assert.equal(first, second);
  await start;
  stream.write(image.subarray(0, 16));
  assert.equal(await cache.getLocalImageUrl(url), null);
  await assert.rejects(fs.stat(cache.getLocalPath(url)), { code: 'ENOENT' });
  stream.end(image.subarray(16));
  const file = await first;
  assert.equal(calls, 1);
  assert.deepEqual(await fs.readFile(file), image);
  assert.match(await cache.getLocalImageUrl(url), /^wallpaper-cache:\/\/image\//);
  await cache.downloadImage(url, '1');
  assert.equal(calls, 1);
});

test('clearing cancels the active stream and does not start the next queued image', async t => {
  let calls = 0;
  let started;
  const start = new Promise(resolve => { started = resolve; });
  const stream = new PassThrough();
  const cache = await fixture(t, async () => {
    calls++;
    started();
    return { data: stream, headers: {} };
  });
  const progress = [];
  const batch = cache.batchDownload([
    { id: '1', imageUrl: url }, { id: '2', imageUrl: 'https://images.example/next.png' }
  ], result => progress.push(result));
  await start;
  stream.write(image.subarray(0, 16));
  await cache.clearCache();
  await batch;
  assert.equal(calls, 1);
  assert.equal(stream.destroyed, true);
  assert.deepEqual(progress, []);
  assert.deepEqual(await fs.readdir(cache.cacheDir), ['metadata.json']);
  assert.deepEqual(JSON.parse(await fs.readFile(cache.metadataFile, 'utf8')), {});
  assert.equal(await cache.getLocalImageUrl(url), null);
  cache.request = async () => response();
  await cache.downloadImage(url, '1');
  assert.equal(await cache.exists(url), true);
});

test('failed or truncated downloads leave no published file and can be retried', async t => {
  const cache = await fixture(t, async () => response(image.subarray(0, 20)));
  await assert.rejects(cache.downloadImage(url, '1'), /不完整|格式/);
  assert.equal(await cache.getLocalImageUrl(url), null);
  assert.deepEqual(await fs.readdir(cache.cacheDir), []);
  cache.request = async () => response();
  await cache.downloadImage(url, '1');
  await fs.truncate(cache.getLocalPath(url), 20);
  assert.equal(await cache.getLocalImageUrl(url), null);
  await cache.downloadImage(url, '1');
  assert.deepEqual(await fs.readFile(cache.getLocalPath(url)), image);
});

test('stream errors reject normally and remove temporary files', async t => {
  const cache = await fixture(t, async () => ({
    data: Readable.from((async function* () {
      yield image.subarray(0, 16);
      throw new Error('network interrupted');
    })()), headers: {}
  }));
  await assert.rejects(cache.downloadImage(url, '1'), /network interrupted/);
  assert.deepEqual(await fs.readdir(cache.cacheDir), []);
});

test('startup ignores orphan files and removes interrupted temporary downloads', async t => {
  const cache = await fixture(t, async () => response());
  await fs.writeFile(cache.getLocalPath(url), image.subarray(0, 20));
  await fs.writeFile(path.join(cache.cacheDir, 'interrupted.part'), image);
  const restarted = new ImageCache(cache.cacheDir);
  await restarted.ready;
  assert.equal(await restarted.getLocalImageUrl(url), null);
  await assert.rejects(fs.stat(path.join(cache.cacheDir, 'interrupted.part')), { code: 'ENOENT' });
});

test('cache protocol rejects traversal and only resolves valid indexed images', async t => {
  const cache = await fixture(t, async () => response());
  await cache.downloadImage(url, '1');
  const localUrl = await cache.getLocalImageUrl(url);
  assert.equal(await cache.resolveCacheUrl(localUrl), cache.getLocalPath(url));
  for (const value of [
    'wallpaper-cache://image/%2e%2e%2fsecret.txt', 'file:///etc/passwd',
    'wallpaper-cache://other/' + cache.generateFileName(url),
    localUrl + '?file=secret', 'wallpaper-cache://image/metadata.json'
  ]) assert.equal(await cache.resolveCacheUrl(value), null);
  await assert.rejects(cache.downloadImage('file:///etc/passwd', '1'));
});

test('clearing before a queued download starts prevents network I/O', async t => {
  let calls = 0;
  const cache = await fixture(t, async () => { calls++; return response(); });
  const download = cache.downloadImage(url, '1');
  const rejected = assert.rejects(download, { name: 'AbortError' });
  await cache.clearCache();
  await rejected;
  assert.equal(calls, 0);
  assert.equal(await cache.exists(url), false);
});

test('different URLs can finish concurrently without losing metadata records', async t => {
  const cache = await fixture(t, async () => response());
  const urls = [url, 'https://images.example/two.png', 'https://images.example/three.png'];
  await Promise.all(urls.map((value, index) => cache.downloadImage(value, String(index))));
  const metadata = JSON.parse(await fs.readFile(cache.metadataFile, 'utf8'));
  assert.deepEqual(Object.keys(metadata).sort(), urls.sort());
  for (const value of urls) assert.equal(await cache.exists(value), true);
});

test('corrupt metadata entries cannot prevent valid cache protocol lookups', async t => {
  const cache = await fixture(t, async () => response());
  await cache.downloadImage(url, '1');
  const metadata = JSON.parse(await fs.readFile(cache.metadataFile, 'utf8'));
  await fs.writeFile(cache.metadataFile, JSON.stringify({ invalid: { fileSize: 20 }, ...metadata }));
  const restarted = new ImageCache(cache.cacheDir);
  await restarted.ready;
  const localUrl = await restarted.getLocalImageUrl(url);
  assert.equal(await restarted.resolveCacheUrl(localUrl), cache.getLocalPath(url));
});
