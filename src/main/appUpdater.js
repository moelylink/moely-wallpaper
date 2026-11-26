import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import { getUpdateInfo } from './updateVersion.js';

export const DEFAULT_VERSION_URL = 'https://wallpaper.moely.link/app/version.txt';
export const DEFAULT_DOWNLOAD_URL = 'https://dl.moely.link/wallpaper/setup.exe';

/**
 * 管理应用自动检查更新、安装包后台流式下载与安装启动。
 */
export default class AppUpdater {
  constructor({
    updatesDir,
    currentVersion,
    versionUrl = DEFAULT_VERSION_URL,
    downloadUrl = DEFAULT_DOWNLOAD_URL,
    userAgent = 'moely-wallpaper',
    httpClient = axios,
    onStateChange = null,
    launchInstaller = null
  }) {
    this.updatesDir = path.resolve(updatesDir);
    this.currentVersion = currentVersion;
    this.versionUrl = versionUrl;
    this.downloadUrl = downloadUrl;
    this.userAgent = userAgent;
    this.httpClient = httpClient;
    this.onStateChange = onStateChange;
    this.launchInstaller = launchInstaller;
    this.activeTask = null;
    this.abortController = null;
    this.state = {
      status: 'idle',
      currentVersion,
      latestVersion: null,
      hasUpdate: false,
      progress: 0,
      installerPath: null,
      updateUrl: downloadUrl,
      error: null
    };
  }

  getState() {
    return { ...this.state };
  }

  _updateState(patch) {
    this.state = { ...this.state, ...patch };
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.getState());
    }
  }

  _resolveInstallerPath(version) {
    const safeVersion = String(version || '').replace(/[^0-9A-Za-z._-]/g, '_');
    const target = path.resolve(this.updatesDir, `moely-wallpaper-setup-${safeVersion}.exe`);
    const relative = path.relative(this.updatesDir, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid installer path');
    }
    return target;
  }

  async checkForUpdate() {
    const response = await this.httpClient.get(this.versionUrl, {
      timeout: 10000,
      maxContentLength: 4096,
      headers: { 'User-Agent': this.userAgent }
    });
    const update = getUpdateInfo(this.currentVersion, response.data);
    return {
      success: true,
      ...update,
      updateUrl: this.downloadUrl
    };
  }

  async checkAndDownload() {
    if (this.activeTask) return this.activeTask;
    this.activeTask = this._runCheckAndDownload().finally(() => {
      this.activeTask = null;
    });
    return this.activeTask;
  }

  async _runCheckAndDownload() {
    try {
      this._updateState({ status: 'checking', error: null });
      const checkResult = await this.checkForUpdate();
      if (!checkResult.hasUpdate) {
        this._updateState({
          status: 'idle',
          latestVersion: checkResult.latestVersion,
          hasUpdate: false,
          progress: 0,
          installerPath: null,
          error: null
        });
        return checkResult;
      }

      const targetPath = this._resolveInstallerPath(checkResult.latestVersion);
      await fs.promises.mkdir(this.updatesDir, { recursive: true });

      const existing = await fs.promises.stat(targetPath).catch(() => null);
      if (existing && existing.isFile() && existing.size > 0) {
        this._updateState({
          status: 'downloaded',
          latestVersion: checkResult.latestVersion,
          hasUpdate: true,
          progress: 100,
          installerPath: targetPath,
          error: null
        });
        return { ...checkResult, installerPath: targetPath, cached: true };
      }

      this._updateState({
        status: 'downloading',
        latestVersion: checkResult.latestVersion,
        hasUpdate: true,
        progress: 0,
        installerPath: null,
        error: null
      });

      const controller = new AbortController();
      this.abortController = controller;
      const tmpPath = `${targetPath}.tmp`;

      try {
        const response = await this.httpClient.get(this.downloadUrl, {
          responseType: 'stream',
          timeout: 30000,
          signal: controller.signal,
          headers: { 'User-Agent': this.userAgent }
        });

        const totalBytes = Number(response.headers?.['content-length']) || 0;
        let downloadedBytes = 0;
        let lastReportedProgress = 0;

        response.data.on('data', chunk => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100));
            if (pct >= lastReportedProgress + 2) {
              lastReportedProgress = pct;
              this._updateState({ progress: pct });
            }
          }
        });

        const writer = fs.createWriteStream(tmpPath, { flags: 'w' });
        await pipeline(response.data, writer);

        const tmpStat = await fs.promises.stat(tmpPath).catch(() => null);
        if (!tmpStat || tmpStat.size <= 0) {
          throw new Error('下载的安装包为空');
        }

        await fs.promises.rename(tmpPath, targetPath);
        this._updateState({
          status: 'downloaded',
          latestVersion: checkResult.latestVersion,
          hasUpdate: true,
          progress: 100,
          installerPath: targetPath,
          error: null
        });
        return { ...checkResult, installerPath: targetPath, cached: false };
      } catch (downloadError) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        throw downloadError;
      } finally {
        if (this.abortController === controller) {
          this.abortController = null;
        }
      }
    } catch (error) {
      const message = error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED'
        ? '更新下载已取消'
        : (error?.message || '检查更新失败');
      this._updateState({
        status: 'error',
        error: message
      });
      return {
        success: false,
        error: message,
        updateUrl: this.downloadUrl
      };
    }
  }

  async installUpdate() {
    const { status, installerPath } = this.state;
    if (status !== 'downloaded' || !installerPath) {
      throw new Error('安装包尚未就绪');
    }
    const resolved = path.resolve(installerPath);
    const relative = path.relative(this.updatesDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('安装包路径无效');
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile() || stat.size <= 0) {
      throw new Error('安装包文件不存在或已损坏');
    }
    if (typeof this.launchInstaller !== 'function') {
      throw new Error('未配置安装程序启动器');
    }
    await this.launchInstaller(resolved);
    return { success: true, installerPath: resolved };
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
