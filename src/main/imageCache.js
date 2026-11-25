import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import { validateImageUrl } from './security.js';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
const CACHE_FILE = /^[a-f0-9]{32}\.(?:jpe?g|png|gif|webp|bmp|avif|img)$/;

function cancelled() {
  return new DOMException('缓存任务已取消', 'AbortError');
}

// 检查格式及常见格式的结尾/长度，拒绝 HTML 和截断文件。
async function validateImageFile(filePath, expectedSize) {
  const file = await fsp.open(filePath, 'r');
  try {
    const { size } = await file.stat();
    if (size < 12 || size > MAX_IMAGE_BYTES || size !== expectedSize) return false;
    const head = Buffer.alloc(Math.min(size, 32));
    const tail = Buffer.alloc(12);
    await file.read(head, 0, head.length, 0);
    await file.read(tail, 0, tail.length, size - tail.length);
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return tail[10] === 0xff && tail[11] === 0xd9;
    }
    if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return tail.subarray(0, 8).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68]));
    }
    if (['GIF87a', 'GIF89a'].includes(head.toString('ascii', 0, 6))) return tail[11] === 0x3b;
    if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
      return head.readUInt32LE(4) + 8 === size;
    }
    if (head.toString('ascii', 0, 2) === 'BM') return head.readUInt32LE(2) === size;
    if (head.toString('ascii', 4, 8) === 'ftyp') {
      return /avif|avis/.test(head.toString('ascii', 8));
    }
    return false;
  } finally {
    await file.close();
  }
}

class ImageCache {
  constructor(cacheDir, { request = axios, userAgent = 'MoelyWallpaper' } = {}) {
    this.cacheDir = cacheDir;
    this.metadataFile = path.join(cacheDir, 'metadata.json');
    this.request = request;
    this.userAgent = userAgent;
    this.metadata = {};
    this.inFlight = new Map();
    this.controllers = new Set();
    this.batches = new Set();
    this.generation = 0;
    this.metadataWrite = Promise.resolve();
    this.clearPromise = null;
    this.ready = this.initialize();
  }

  async initialize() {
    await fsp.mkdir(this.cacheDir, { recursive: true });
    try {
      const metadata = JSON.parse(await fsp.readFile(this.metadataFile, 'utf8'));
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        for (const [url, info] of Object.entries(metadata)) {
          try {
            validateImageUrl(url);
            if (info && Number.isFinite(info.fileSize) && info.fileSize > 0) this.metadata[url] = info;
          } catch {
            // 忽略损坏的索引记录，不让一条错误记录阻塞其余缓存。
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Ignoring invalid cache metadata:', error.message);
    }
    for (const file of await fsp.readdir(this.cacheDir)) {
      if (file.endsWith('.part') || file.startsWith('metadata.json.')) {
        await fsp.rm(path.join(this.cacheDir, file), { force: true });
      }
    }
  }

  generateFileName(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    const ext = /^\.(jpe?g|png|gif|webp|bmp|avif)$/.test(extension) ? extension : '.img';
    return `${hash}${ext}`;
  }

  getLocalPath(url) {
    return path.join(this.cacheDir, this.generateFileName(url));
  }

  isCacheExpired(url) {
    const time = Date.parse(this.metadata[url]?.downloadTime);
    return !Number.isFinite(time) || Date.now() - time > MAX_CACHE_AGE;
  }

  async exists(url) {
    await this.ready;
    const info = this.metadata[url];
    if (this.clearPromise || !info || this.isCacheExpired(url)) return false;
    try {
      return await validateImageFile(this.getLocalPath(url), info.fileSize);
    } catch {
      return false;
    }
  }

  writeMetadata() {
    const data = JSON.stringify(this.metadata, null, 2);
    const tempPath = `${this.metadataFile}.${crypto.randomUUID()}.part`;
    const write = this.metadataWrite.catch(() => {}).then(async () => {
      try {
        await fsp.writeFile(tempPath, data, { flag: 'wx' });
        await fsp.rename(tempPath, this.metadataFile);
      } finally {
        await fsp.rm(tempPath, { force: true });
      }
    });
    this.metadataWrite = write;
    return write;
  }

  async cleanupExpiredCache() {
    await this.ready;
    let cleaned = 0;
    for (const url of Object.keys(this.metadata)) {
      if (!this.inFlight.has(url) && this.isCacheExpired(url)) {
        try {
          await fsp.rm(this.getLocalPath(url), { force: true });
          delete this.metadata[url];
          cleaned++;
        } catch (error) {
          console.error('Failed to remove expired cache:', error.message);
        }
      }
    }
    if (cleaned) await this.writeMetadata();
    return cleaned;
  }

  downloadImage(url, wallpaperId) {
    try {
      validateImageUrl(url);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.clearPromise) return Promise.reject(cancelled());
    if (this.inFlight.has(url)) return this.inFlight.get(url);
    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = this.download(url, wallpaperId, controller, generation).finally(() => {
      this.inFlight.delete(url);
      this.controllers.delete(controller);
    });
    this.inFlight.set(url, task);
    return task;
  }

  async download(url, wallpaperId, controller, generation) {
    const { signal } = controller;
    const checkCancelled = () => {
      if (signal.aborted || generation !== this.generation) throw cancelled();
    };
    const localPath = this.getLocalPath(url);
    const tempPath = `${localPath}.${crypto.randomUUID()}.part`;
    let published = false;
    let response;
    const deadline = setTimeout(() => controller.abort(), 30000);
    try {
      await this.ready;
      checkCancelled();
      if (await this.exists(url)) {
        checkCancelled();
        return localPath;
      }
      response = await this.request({
        method: 'GET', url, responseType: 'stream', timeout: 30000, signal,
        decompress: false,
        headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': 'identity' },
        beforeRedirect: options => {
          if (options.protocol !== 'https:') throw new Error('Image redirect must use HTTPS');
        }
      });
      checkCancelled();
      let size = 0;
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(size > MAX_IMAGE_BYTES ? new Error('图片超过 100 MB 限制') : null, chunk);
        }
      });
      await pipeline(response.data, limiter, fs.createWriteStream(tempPath, { flags: 'wx' }), { signal });
      checkCancelled();
      const length = Number(response.headers?.['content-length']);
      if ((Number.isFinite(length) && length > 0 && length !== size) ||
          !await validateImageFile(tempPath, size)) {
        throw new Error('图片下载不完整或格式不受支持');
      }
      checkCancelled();
      await fsp.rename(tempPath, localPath);
      published = true;
      checkCancelled();
      this.metadata[url] = {
        id: wallpaperId, downloadTime: new Date().toISOString(), originalUrl: url, fileSize: size
      };
      await this.writeMetadata();
      checkCancelled();
      return localPath;
    } catch (error) {
      response?.data?.destroy();
      if (published) {
        delete this.metadata[url];
        await fsp.rm(localPath, { force: true });
      }
      throw error;
    } finally {
      clearTimeout(deadline);
      await fsp.rm(tempPath, { force: true });
    }
  }

  async getLocalImageUrl(url) {
    if (!await this.exists(url)) return null;
    return `wallpaper-cache://image/${this.generateFileName(url)}`;
  }

  async resolveCacheUrl(value) {
    const url = new URL(value);
    const file = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== 'wallpaper-cache:' || url.hostname !== 'image' ||
        url.port || url.username || url.password || url.search || url.hash || !CACHE_FILE.test(file)) return null;
    await this.ready;
    const originalUrl = Object.keys(this.metadata).find(key => this.generateFileName(key) === file);
    return originalUrl && await this.exists(originalUrl) ? this.getLocalPath(originalUrl) : null;
  }

  batchDownload(wallpapers, onCached) {
    if (this.clearPromise) return Promise.reject(cancelled());
    const generation = this.generation;
    const task = (async () => {
      const results = [];
      for (const wallpaper of wallpapers) {
        if (generation !== this.generation) break;
        try {
          await this.downloadImage(wallpaper.originalUrl || wallpaper.imageUrl, wallpaper.id);
          if (generation !== this.generation) break;
          const imageUrl = await this.getLocalImageUrl(wallpaper.originalUrl || wallpaper.imageUrl);
          if (generation !== this.generation) break;
          if (imageUrl) {
            const result = { ...wallpaper, imageUrl, isLocal: true, cached: true };
            results.push(result);
            onCached?.(result);
          }
        } catch (error) {
          if (generation !== this.generation) break;
          results.push({ ...wallpaper, cached: false, error: error.message });
        }
      }
      return results;
    })().finally(() => this.batches.delete(task));
    this.batches.add(task);
    return task;
  }

  clearCache() {
    if (this.clearPromise) return this.clearPromise;
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.clearPromise = (async () => {
      await this.ready;
      await Promise.allSettled([...this.inFlight.values(), ...this.batches]);
      await this.metadataWrite.catch(() => {});
      let clearedCount = 0;
      for (const file of await fsp.readdir(this.cacheDir, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        await fsp.unlink(path.join(this.cacheDir, file.name));
        if (CACHE_FILE.test(file.name)) clearedCount++;
      }
      this.metadata = {};
      await this.writeMetadata();
      return clearedCount;
    })().finally(() => { this.clearPromise = null; });
    return this.clearPromise;
  }

  async cancelDownloads() {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.inFlight.values(), ...this.batches]);
    await this.metadataWrite.catch(() => {});
  }
}

export default ImageCache;
