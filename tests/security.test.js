import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isAppUrl, isRequestId, parseExternalUrl, validateImageUrl } from '../src/main/security.js';

test('external URLs accept only HTTP(S) without embedded credentials', () => {
  assert.equal(parseExternalUrl('https://example.com/path').hostname, 'example.com');
  for (const value of ['file:///secret', 'javascript:alert(1)', 'data:text/html,test',
    'ms-settings:test', 'https://user:pass@example.com', null, {}]) {
    assert.throws(() => parseExternalUrl(value));
  }
  assert.throws(() => validateImageUrl('http://example.com/image.jpg'));
});

test('trusted application URLs reject different origins, paths and query strings', () => {
  assert.equal(isAppUrl('http://localhost:3000/#test', 'http://localhost:3000/'), true);
  assert.equal(isAppUrl('http://localhost:3000/evil', 'http://localhost:3000/'), false);
  assert.equal(isAppUrl('https://example.com/', 'http://localhost:3000/'), false);
  assert.equal(isAppUrl('file:///C:/app/other.html', 'file:///C:/app/index.html'), false);
  assert.equal(isAppUrl('file:///C:/app/index.html', 'file:///C:/app/index.html'), true);
  assert.equal(isRequestId({}), false);
  assert.equal(isRequestId('request-123'), true);
});

test('preload exposes named operations, hides IPC and removes only its own subscription', () => {
  let api;
  const events = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: (...args) => { events.push(args); return Promise.resolve({}); },
    send: (...args) => events.push(args),
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      assert.equal(listeners.get(channel), listener);
      listeners.delete(channel);
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../src/main/preload.cjs', import.meta.url), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => {
        assert.equal(name, 'wallpaperAPI');
        api = value;
      } } };
    }
  });
  assert.equal(api.invoke, undefined);
  assert.equal(api.send, undefined);
  assert.equal(Object.isFrozen(api), true);
  api.setWallpaper('1');
  api.cacheImages([{ imageUrl: 'file:///secret' }]);
  assert.deepEqual(events, [['set-wallpaper', '1'], ['cache-images']]);
  let received;
  const unsubscribe = api.onImageCached(value => { received = value; });
  const payload = { id: '1' };
  listeners.get('image-cached')({ sender: 'private' }, payload);
  assert.equal(received, payload);
  unsubscribe();
  assert.equal(listeners.size, 0);
});
