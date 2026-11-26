import test from 'node:test';
import assert from 'node:assert/strict';
import TelemetryClient from '../src/main/telemetry.js';

test('TelemetryClient sends formatted Aptabase event with App-Key header', async () => {
  const requests = [];
  const client = new TelemetryClient({
    appKey: 'A-US-8264310255',
    appVersion: '1.1.0',
    locale: 'zh-CN',
    osName: 'Windows',
    osVersion: '10.0.26200',
    isDebug: false,
    enabled: true,
    httpClient: {
      post: async (url, body, config) => {
        requests.push({ url, body, config });
        return { status: 200 };
      }
    }
  });

  const ok = await client.trackEvent('app_started', { silent: false, count: 1, ignored: { nested: true } });
  assert.equal(ok, true);
  assert.equal(requests.length, 1);

  const req = requests[0];
  assert.equal(req.url, 'https://us.aptabase.com/api/v0/events');
  assert.equal(req.config.headers['App-Key'], 'A-US-8264310255');
  assert.equal(Array.isArray(req.body), true);
  assert.equal(req.body[0].eventName, 'app_started');
  assert.match(req.body[0].sessionId, /^\d{18,}$/);
  assert.deepEqual(req.body[0].props, { silent: false, count: 1 });
  assert.equal(req.body[0].systemProps.appVersion, '1.1.0');
});

test('TelemetryClient skips network calls when disabled and swallows errors silently', async () => {
  let called = false;
  const disabled = new TelemetryClient({
    appKey: 'A-US-8264310255',
    enabled: false,
    httpClient: {
      post: async () => {
        called = true;
      }
    }
  });
  assert.equal(await disabled.trackEvent('app_started'), false);
  assert.equal(called, false);

  const failing = new TelemetryClient({
    appKey: 'A-US-8264310255',
    enabled: true,
    httpClient: {
      post: async () => {
        throw new Error('network timeout');
      }
    }
  });
  assert.equal(await failing.trackEvent('app_started'), false);
});
