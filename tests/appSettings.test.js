import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AppSettings, { DEFAULT_CLOSE_BEHAVIOR, DEFAULT_THEME_COLOR, DEFAULT_WALLPAPER_SCALE } from '../src/main/appSettings.js';

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
    assert.deepEqual(reloaded.getCurrentWallpaper(), { id: '126799507', artist: '星井やな', isEdited: false, appliedPath: '', systemPath: '' });
  });

  it('defaults silentStart to false and persists boolean values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getSilentStart(), false);
    await settings.setSilentStart(true);
    await assert.rejects(() => settings.setSilentStart('yes'), /Invalid silent start value/);

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.getSilentStart(), true);
  });

  it('defaults autoUpdate to true and persists boolean values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getAutoUpdate(), true);
    await settings.setAutoUpdate(false);
    await assert.rejects(() => settings.setAutoUpdate('no'), /Invalid auto update value/);

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.getAutoUpdate(), false);
  });

  it('defaults wallpaperScale to fill and persists fit while rejecting invalid values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.getWallpaperScale(), DEFAULT_WALLPAPER_SCALE);
    assert.equal(settings.getWallpaperScale(), 'fill');

    await settings.setWallpaperScale('fit');
    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.getWallpaperScale(), 'fit');
    await assert.rejects(() => reloaded.setWallpaperScale('stretch'), /Invalid wallpaper scale/);
  });

  it('defaults autoStart to true and persists explicit boolean preference', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moely-settings-'));
    const filePath = path.join(dir, 'settings.json');
    const settings = new AppSettings(filePath);
    await settings.ready;
    assert.equal(settings.hasAutoStartPreference(), false);
    assert.equal(settings.getAutoStart(), true);

    await settings.setAutoStart(false);
    await assert.rejects(() => settings.setAutoStart('yes'), /Invalid auto-start value/);

    const reloaded = new AppSettings(filePath);
    await reloaded.ready;
    assert.equal(reloaded.hasAutoStartPreference(), true);
    assert.equal(reloaded.getAutoStart(), false);
  });
});
