import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import AppUpdater from '../src/main/appUpdater.js';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'moely-updater-'));
}

test('AppUpdater skips download when current version is up to date', async () => {
  const updatesDir = createTempDir();
  let downloadCalled = false;
  const updater = new AppUpdater({
    updatesDir,
    currentVersion: '1.1.0',
    httpClient: {
      get: async url => {
        if (url.endsWith('version.txt')) return { data: '1.1.0', headers: {} };
        downloadCalled = true;
        throw new Error('Should not download');
      }
    }
  });

  const result = await updater.checkAndDownload();
  assert.equal(result.success, true);
  assert.equal(result.hasUpdate, false);
  assert.equal(downloadCalled, false);
  assert.equal(updater.getState().status, 'idle');
  await fs.promises.rm(updatesDir, { recursive: true, force: true });
});

test('AppUpdater downloads installer atomically and emits progress/downloaded states', async () => {
  const updatesDir = createTempDir();
  const states = [];
  const payload = Buffer.from('MZ-fake-nsis-installer-content');
  let launchedPath = null;

  const updater = new AppUpdater({
    updatesDir,
    currentVersion: '1.1.0',
    onStateChange: state => states.push(state),
    launchInstaller: async filePath => { launchedPath = filePath; },
    httpClient: {
      get: async url => {
        if (url.endsWith('version.txt')) return { data: 'v1.2.0', headers: {} };
        if (url.endsWith('setup.exe')) {
          return {
            data: Readable.from([payload.subarray(0, 10), payload.subarray(10)]),
            headers: { 'content-length': String(payload.length) }
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    }
  });

  const result = await updater.checkAndDownload();
  assert.equal(result.success, true);
  assert.equal(result.hasUpdate, true);
  assert.equal(result.latestVersion, '1.2.0');
  assert.equal(fs.readFileSync(result.installerPath).equals(payload), true);
  assert.equal(fs.existsSync(`${result.installerPath}.tmp`), false);
  assert.equal(states.some(s => s.status === 'downloading'), true);
  assert.equal(states[states.length - 1].status, 'downloaded');
  assert.equal(states[states.length - 1].progress, 100);

  const installResult = await updater.installUpdate();
  assert.equal(installResult.success, true);
  assert.equal(launchedPath, result.installerPath);
  await fs.promises.rm(updatesDir, { recursive: true, force: true });
});

test('AppUpdater reuses already downloaded installer for the same version', async () => {
  const updatesDir = createTempDir();
  const cachedInstaller = path.join(updatesDir, 'moely-wallpaper-setup-1.2.0.exe');
  fs.writeFileSync(cachedInstaller, 'cached-installer');
  let downloadCalls = 0;

  const updater = new AppUpdater({
    updatesDir,
    currentVersion: '1.1.0',
    httpClient: {
      get: async url => {
        if (url.endsWith('version.txt')) return { data: '1.2.0', headers: {} };
        downloadCalls++;
        throw new Error('Should reuse cached installer');
      }
    }
  });

  const result = await updater.checkAndDownload();
  assert.equal(result.success, true);
  assert.equal(result.cached, true);
  assert.equal(downloadCalls, 0);
  assert.equal(updater.getState().status, 'downloaded');
  await fs.promises.rm(updatesDir, { recursive: true, force: true });
});

test('AppUpdater cleans up temporary file on stream failure and rejects invalid install', async () => {
  const updatesDir = createTempDir();
  const updater = new AppUpdater({
    updatesDir,
    currentVersion: '1.1.0',
    httpClient: {
      get: async url => {
        if (url.endsWith('version.txt')) return { data: '1.3.0', headers: {} };
        if (url.endsWith('setup.exe')) {
          return {
            data: new Readable({
              read() {
                this.destroy(new Error('network reset'));
              }
            }),
            headers: {}
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    }
  });

  const result = await updater.checkAndDownload();
  assert.equal(result.success, false);
  assert.match(result.error, /network reset/);
  assert.equal(updater.getState().status, 'error');
  assert.equal(fs.existsSync(path.join(updatesDir, 'moely-wallpaper-setup-1.3.0.exe.tmp')), false);
  await assert.rejects(() => updater.installUpdate(), /安装包尚未就绪/);
  await fs.promises.rm(updatesDir, { recursive: true, force: true });
});
