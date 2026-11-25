import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WallpaperCatalog, { normalizeWallpapers } from '../src/main/wallpaperCatalog.js';

const remote = [{ id: 1, user: 'artist', category: 'source', original: 'https://images.example/one.png' }];

async function fixture(t, request, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moely-catalog-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'wallpapers.json');
  const cache = { getLocalImageUrl: async () => null };
  return new WallpaperCatalog(file, cache, { request, requestTimeout: 20, retryDelay: 1, ...options });
}

function pendingRequest(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('valid catalog is saved with complete display fields and restored offline', async t => {
  const catalog = await fixture(t, async () => ({ data: remote }));
  const first = await catalog.fetch();
  assert.equal(first.success, true);
  assert.equal(first.offline, false);
  assert.equal(first.wallpapers[0].artist, 'artist');
  const restored = new WallpaperCatalog(catalog.filePath, {
    getLocalImageUrl: async () => 'wallpaper-cache://image/cached.png'
  }, { request: async () => { throw new Error('offline'); }, retryDelay: 1 });
  const result = await restored.fetch();
  assert.equal(result.success, true);
  assert.equal(result.offline, true);
  assert.equal(result.wallpapers[0].id, '1');
  assert.equal(result.wallpapers[0].isLocal, true);
  assert.equal(result.wallpapers[0].source, 'source');
  assert.match(result.warning, /上次保存/);
});

test('network failure without saved data is an error, not an empty catalog', async t => {
  const catalog = await fixture(t, async () => { throw new Error('offline'); });
  const result = await catalog.fetch();
  assert.equal(result.success, false);
  assert.match(result.error, /获取壁纸失败/);
});

test('a genuine empty catalog is returned as a successful empty result', async t => {
  const catalog = await fixture(t, async () => ({ data: [] }));
  const result = await catalog.fetch();
  assert.equal(result.success, true);
  assert.deepEqual(result.wallpapers, []);
});

test('second attempt can succeed without a separate renderer timeout discarding it', async t => {
  let attempts = 0;
  const catalog = await fixture(t, async () => {
    if (++attempts === 1) throw new Error('first attempt timed out');
    return { data: remote };
  });
  const result = await catalog.fetch();
  assert.equal(attempts, 2);
  assert.equal(result.success, true);
});

test('caller cancellation stops the request without falling back or retrying', async t => {
  const catalog = await fixture(t, pendingRequest);
  await catalog.ready;
  const controller = new AbortController();
  const request = catalog.fetch({ signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('overall deadline cancels a stalled request and returns an offline fallback', async t => {
  const catalog = await fixture(t, async () => ({ data: remote }), { totalTimeout: 20 });
  await catalog.fetch();
  catalog.request = pendingRequest;
  const result = await catalog.fetch();
  assert.equal(result.success, true);
  assert.equal(result.offline, true);
});

test('overall deadline without cache returns a useful timeout error', async t => {
  const catalog = await fixture(t, pendingRequest, { totalTimeout: 20 });
  const result = await catalog.fetch();
  assert.equal(result.success, false);
  assert.match(result.error, /请求超时/);
});

test('invalid remote records are skipped; invalid responses preserve saved data', async t => {
  assert.equal(normalizeWallpapers([...remote, { id: 2, original: 'file:///secret' }, remote[0]]).length, 1);
  const catalog = await fixture(t, async () => ({ data: remote }));
  await catalog.fetch();
  catalog.request = async () => ({ data: { message: 'invalid' } });
  const result = await catalog.fetch();
  assert.equal(result.offline, true);
  assert.equal(catalog.getById('1').originalUrl, remote[0].original);
});
