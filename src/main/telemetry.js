import crypto from 'node:crypto';
import os from 'node:os';
import axios from 'axios';

const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_APP_KEY = 'A-US-8264310255';

function resolveEndpoint(appKey) {
  if (typeof appKey !== 'string') return null;
  const parts = appKey.trim().split('-');
  if (parts.length < 2) return null;
  const region = parts[1].toUpperCase();
  if (region === 'EU') return 'https://eu.aptabase.com/api/v0/events';
  if (region === 'US') return 'https://us.aptabase.com/api/v0/events';
  return null;
}

function resolveOsName(platform = process.platform) {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object') return {};
  const clean = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof key !== 'string' || !key) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * 基于现有 Axios 实现的轻量级 Aptabase 桌面端事件上报客户端。
 */
export default class TelemetryClient {
  constructor({
    appKey = DEFAULT_APP_KEY,
    appVersion = '1.0.0',
    locale = 'zh-CN',
    osName = resolveOsName(),
    osVersion = os.release(),
    isDebug = false,
    enabled = true,
    httpClient = axios
  } = {}) {
    this.appKey = typeof appKey === 'string' ? appKey.trim() : '';
    this.endpoint = resolveEndpoint(this.appKey);
    this.appVersion = appVersion;
    this.locale = locale;
    this.osName = osName;
    this.osVersion = osVersion;
    this.isDebug = Boolean(isDebug);
    this.enabled = Boolean(enabled && this.endpoint);
    this.httpClient = httpClient;
    this.sessionId = null;
    this.lastActivityAt = 0;
    this.controllers = new Set();
  }

  _getSessionId(now = Date.now()) {
    if (!this.sessionId || now - this.lastActivityAt > SESSION_TIMEOUT_MS) {
      const epochSec = Math.floor(now / 1000);
      const rand = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
      this.sessionId = `${epochSec}${rand}`;
    }
    this.lastActivityAt = now;
    return this.sessionId;
  }

  async trackEvent(eventName, props = {}, { timeoutMs = 5000 } = {}) {
    if (!this.enabled || !this.endpoint || typeof eventName !== 'string' || !eventName.trim()) {
      return false;
    }

    const now = Date.now();
    const payload = [
      {
        timestamp: new Date(now).toISOString(),
        sessionId: this._getSessionId(now),
        eventName: eventName.trim(),
        systemProps: {
          locale: this.locale,
          osName: this.osName,
          osVersion: this.osVersion,
          isDebug: this.isDebug,
          appVersion: this.appVersion,
          sdkVersion: 'moely-axios@1.0.0'
        },
        props: sanitizeProps(props)
      }
    ];

    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      await this.httpClient.post(this.endpoint, payload, {
        timeout: timeoutMs,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'App-Key': this.appKey
        }
      });
      return true;
    } catch {
      return false;
    } finally {
      this.controllers.delete(controller);
    }
  }

  cancel() {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
