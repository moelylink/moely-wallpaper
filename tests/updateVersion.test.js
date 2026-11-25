import test from 'node:test';
import assert from 'node:assert/strict';
import { getUpdateInfo } from '../src/main/updateVersion.js';

test('only a newer semantic version is offered as an update', () => {
  assert.equal(getUpdateInfo('1.1.0', '1.0.9').hasUpdate, false);
  assert.equal(getUpdateInfo('1.1.0', '1.1.0').hasUpdate, false);
  assert.equal(getUpdateInfo('1.1.0', '1.1.1').hasUpdate, true);
  assert.equal(getUpdateInfo('1.9.0', '1.10.0').hasUpdate, true);
  assert.equal(getUpdateInfo('1.10.0', '1.9.0').hasUpdate, false);
  assert.equal(getUpdateInfo('1.0.0', '2.0.0').hasUpdate, true);
});

test('prerelease precedence and build metadata follow semantic version rules', () => {
  assert.equal(getUpdateInfo('1.1.0', '1.1.0-beta.2').hasUpdate, false);
  assert.equal(getUpdateInfo('1.1.0-beta.2', '1.1.0-beta.10').hasUpdate, true);
  assert.equal(getUpdateInfo('1.1.0-beta.10', '1.1.0').hasUpdate, true);
  assert.equal(getUpdateInfo('1.1.0+build.1', '1.1.0+build.2').hasUpdate, false);
});

test('version text accepts an optional v prefix and surrounding whitespace', () => {
  assert.deepEqual(getUpdateInfo('1.1.0', '﻿ v1.2.0\r\n'), {
    currentVersion: '1.1.0', latestVersion: '1.2.0', hasUpdate: true
  });
});

test('malformed release responses fail explicitly instead of offering a download', () => {
  for (const value of ['', '1.2', '01.2.3', '<html>error</html>', 'latest', '1.2.3\n2.0.0', {}, null]) {
    assert.throws(() => getUpdateInfo('1.1.0', value), /更新服务返回的版本号无效/);
  }
  assert.throws(() => getUpdateInfo('broken', '1.2.3'), /当前应用版本号无效/);
});
