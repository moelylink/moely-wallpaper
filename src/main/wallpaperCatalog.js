import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import axios from 'axios';
import { validateImageUrl } from './security.js';

const API_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/moelylink/wallpaper-api/refs/heads/main/wallpaper.json';

export function normalizeWallpapers(data, persisted = false) {
  if (!Array.isArray(data) || data.length > 5000) throw new Error('壁纸目录格式无效');
  const seen = new Set();
  const wallpapers = [];
  for (const item of data) {
    if (!item || !['string', 'number'].includes(typeof item.id)) continue;
    const id = String(item.id);
    if (!id || id.length > 128 || seen.has(id)) continue;
    try {
      const originalUrl = validateImageUrl(persisted ? item.originalUrl : item.original);
      seen.add(id);
      wallpapers.push({
        id,
        artist: String((persisted ? item.artist : item.user) ?? '').slice(0, 500),
        source: String((persisted ? item.source : item.category) ?? '').slice(0, 500),
        originalUrl,
        imageUrl: originalUrl,
        isLocal: false
      });
    } catch {
      // 坏记录不影响其余壁纸，但不接受本地文件或非 HTTPS 地址。
    }
  }
  if (data.length && !wallpapers.length) throw new Error('目录中没有有效壁纸');
  return wallpapers;
}

class WallpaperCatalog {
  constructor(filePath, imageCache, {
    request = axios.get, userAgent = 'MoelyWallpaper',
    requestTimeout = 10000, retryDelay = 2000, totalTimeout = 25000
  } = {}) {
    this.filePath = filePath;
    this.imageCache = imageCache;
    this.request = request;
    this.userAgent = userAgent;
    this.requestTimeout = requestTimeout;
    this.retryDelay = retryDelay;
    this.totalTimeout = totalTimeout;
    this.wallpapers = [];
    this.ready = this.load();
  }

  async load() {
    try {
      this.wallpapers = normalizeWallpapers(JSON.parse(await fs.readFile(this.filePath, 'utf8')), true);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Ignoring invalid offline catalog:', error.message);
    }
  }

  async save(wallpapers) {
    const temporary = `${this.filePath}.${crypto.randomUUID()}.part`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(wallpapers), { flag: 'wx' });
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async withCache(wallpapers = this.wallpapers) {
    const results = new Array(wallpapers.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(4, wallpapers.length) }, async () => {
      while (nextIndex < wallpapers.length) {
        const index = nextIndex++;
        const wallpaper = wallpapers[index];
        const localUrl = await this.imageCache.getLocalImageUrl(wallpaper.originalUrl);
        results[index] = { ...wallpaper, imageUrl: localUrl || wallpaper.originalUrl, isLocal: !!localUrl };
      }
    }));
    return results;
  }

  async fetch({ signal } = {}) {
    await this.ready;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const deadline = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), this.totalTimeout);
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        try {
          response = await this.request(API_URL, {
            timeout: this.requestTimeout, signal: controller.signal, family: 4,
            maxContentLength: 8 * 1024 * 1024,
            headers: { 'User-Agent': this.userAgent }
          });
          break;
        } catch (error) {
          if (attempt === 1 || controller.signal.aborted) throw error;
          await delay(this.retryDelay, undefined, { signal: controller.signal });
        }
      }
      controller.signal.throwIfAborted();
      const wallpapers = normalizeWallpapers(response.data);
      this.wallpapers = wallpapers;
      let warning = '';
      try {
        await this.save(wallpapers);
      } catch (error) {
        console.error('Failed to save offline catalog:', error.message);
        warning = '壁纸目录无法保存，离线功能可能不可用';
      }
      const result = await this.withCache(wallpapers);
      if (signal?.aborted) throw signal.reason;
      return { success: true, wallpapers: result, offline: false, warning };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (this.wallpapers.length) {
        return {
          success: true, wallpapers: await this.withCache(), offline: true,
          warning: '网络不可用，正在使用上次保存的壁纸目录'
        };
      }
      return {
        success: false, wallpapers: [], offline: false,
        error: controller.signal.aborted ? '请求超时，请检查网络连接后重试' : '获取壁纸失败，请检查网络连接后重试'
      };
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
    }
  }

  getById(id) {
    return this.wallpapers.find(wallpaper => wallpaper.id === String(id));
  }
}

export default WallpaperCatalog;
