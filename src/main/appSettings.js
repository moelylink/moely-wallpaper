import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const VALID_CLOSE_BEHAVIORS = new Set(['tray', 'exit']);
export const DEFAULT_CLOSE_BEHAVIOR = 'tray';
export const DEFAULT_THEME_COLOR = '#ff00b4';

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeCurrentWallpaper(value) {
  if (!value || typeof value !== 'object') return null;
  if (!['string', 'number'].includes(typeof value.id)) return null;
  const id = String(value.id).trim();
  if (!id || id.length > 128) return null;
  const artist = typeof value.artist === 'string' ? value.artist.slice(0, 500) : '';
  const appliedPath = typeof value.appliedPath === 'string' ? value.appliedPath.slice(0, 1024) : '';
  const systemPath = typeof value.systemPath === 'string' ? value.systemPath.slice(0, 1024) : '';
  return { id, artist, isEdited: Boolean(value.isEdited), appliedPath, systemPath };
}

/**
 * Persists user-configurable application settings in userData.
 */
class AppSettings {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      closeBehavior: DEFAULT_CLOSE_BEHAVIOR,
      themeColor: DEFAULT_THEME_COLOR,
      currentWallpaper: null,
      silentStart: false,
      autoUpdate: true
    };
    this.writeQueue = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        const next = { ...this.data };
        if (VALID_CLOSE_BEHAVIORS.has(raw.closeBehavior)) {
          next.closeBehavior = raw.closeBehavior;
        }
        const validColor = normalizeHexColor(raw.themeColor);
        if (validColor) {
          next.themeColor = validColor;
        }
        next.currentWallpaper = normalizeCurrentWallpaper(raw.currentWallpaper);
        if (typeof raw.silentStart === 'boolean') {
          next.silentStart = raw.silentStart;
        }
        if (typeof raw.autoUpdate === 'boolean') {
          next.autoUpdate = raw.autoUpdate;
        }
        this.data = next;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Ignoring invalid settings file:', error.message);
      }
    }
  }

  getCloseBehavior() {
    return this.data.closeBehavior;
  }

  getThemeColor() {
    return this.data.themeColor;
  }

  getCurrentWallpaper() {
    return this.data.currentWallpaper;
  }

  getSilentStart() {
    return this.data.silentStart;
  }

  getAutoUpdate() {
    return this.data.autoUpdate;
  }

  async _persist(patch) {
    await this.ready;
    this.data = { ...this.data, ...patch };
    const snapshot = JSON.stringify(this.data, null, 2);
    const writeTask = this.writeQueue.then(async () => {
      const temporary = `${this.filePath}.${crypto.randomUUID()}.part`;
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(temporary, snapshot, { flag: 'wx' });
        await fs.rename(temporary, this.filePath);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
    this.writeQueue = writeTask.catch(() => {});
    return writeTask;
  }

  async setCloseBehavior(behavior) {
    if (!VALID_CLOSE_BEHAVIORS.has(behavior)) {
      throw new Error('Invalid close behavior');
    }
    return this._persist({ closeBehavior: behavior });
  }

  async setThemeColor(color) {
    const normalized = normalizeHexColor(color);
    if (!normalized) {
      throw new Error('Invalid theme color');
    }
    return this._persist({ themeColor: normalized });
  }

  async setCurrentWallpaper(wallpaper) {
    const normalized = wallpaper === null ? null : normalizeCurrentWallpaper(wallpaper);
    if (wallpaper !== null && !normalized) {
      throw new Error('Invalid current wallpaper');
    }
    return this._persist({ currentWallpaper: normalized });
  }

  async setSilentStart(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid silent start value');
    }
    return this._persist({ silentStart: enabled });
  }

  async setAutoUpdate(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid auto update value');
    }
    return this._persist({ autoUpdate: enabled });
  }
}

export default AppSettings;
