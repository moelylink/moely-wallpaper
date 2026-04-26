import { app } from 'electron';

export function getAppUserAgent() {
  return `MoelyWallpaper/${app.getVersion()}`;
}
