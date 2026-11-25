import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AppSettings, { DEFAULT_CLOSE_BEHAVIOR, DEFAULT_THEME_COLOR } from '../src/main/appSettings.js';

describe('AppSettings', () => {
  it('defaults closeBehavior to tray when file does not exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const settings = new AppSettings(path.join(dir, 'settings.json'));
    await settings.ready;
    assert.equal(settings.getCloseBehavior(), DEFAULT_CLOSE_BEHAVIOR);
    assert.equal(settings.getCloseBehavior(), 'tray');
  });

  it('persists and reloads valid closeBehavior values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    await settings.setCloseBehavior('exit');
    assert.equal(settings.getCloseBehavior(), 'exit');

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.getCloseBehavior(), 'exit');
  });

  it('rejects invalid closeBehavior values and falls back on corrupted JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    fs.writeFileSync(filePath, '{not valid json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getCloseBehavior(), 'tray');
    await assert.rejects(() => settings.setCloseBehavior('invalid'), /Invalid close behavior/);
  });

  it('defaults themeColor and persists valid hex colors while preserving closeBehavior', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getThemeColor(), DEFAULT_THEME_COLOR);

    await settings.setCloseBehavior('exit');
    await settings.setThemeColor('#2F8CFF');
    assert.equal(settings.getThemeColor(), '#2f8cff');

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.getCloseBehavior(), 'exit');
    assert.equal(reloaded.getThemeColor(), '#2f8cff');
    await assert.rejects(() => reloaded.setThemeColor('not-a-color'), /Invalid theme color/);
  });

  it('persists current desktop wallpaper info', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getCurrentWallpaper(), null);
    await settings.setCurrentWallpaper({ id: '126799507', artist: '星井やな' });

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.deepEqual(reloaded.getCurrentWallpaper(), { id: '126799507', artist: '星井やな', isEdited: false });
  });
});
