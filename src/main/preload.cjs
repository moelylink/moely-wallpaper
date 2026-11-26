const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperAPI', Object.freeze({
  fetchWallpapers: requestId => ipcRenderer.invoke('fetch-wallpapers', requestId),
  cancelFetchWallpapers: requestId => ipcRenderer.send('cancel-fetch-wallpapers', requestId),
  cacheImages: () => ipcRenderer.invoke('cache-images'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  setWallpaper: id => ipcRenderer.invoke('set-wallpaper', id),
  setEditedWallpaper: (payload, wallpaperId) => ipcRenderer.invoke('set-edited-wallpaper', payload, wallpaperId),
  saveEditedWallpaper: payload => ipcRenderer.invoke('save-edited-wallpaper', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setAutoStart: enabled => ipcRenderer.invoke('set-auto-start', enabled),
  setSilentStart: enabled => ipcRenderer.invoke('set-silent-start', enabled),
  setAutoUpdate: enabled => ipcRenderer.invoke('set-auto-update', enabled),
  setCloseBehavior: behavior => ipcRenderer.invoke('set-close-behavior', behavior),
  setThemeColor: color => ipcRenderer.invoke('set-theme-color', color),
  syncCurrentWallpaper: id => ipcRenderer.send('sync-current-wallpaper', id),
  fetchNotice: () => ipcRenderer.invoke('fetch-notice'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  openExternal: url => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  onMaximizedChange: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on('window-maximized-change', listener);
    return () => ipcRenderer.removeListener('window-maximized-change', listener);
  },
  close: () => ipcRenderer.send('window-close'),
  setFullscreen: enabled => ipcRenderer.invoke('set-fullscreen', enabled),
  onFullscreenChange: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('fullscreen-change', listener);
    return () => ipcRenderer.removeListener('fullscreen-change', listener);
  },
  onImageCached: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, wallpaper) => callback(wallpaper);
    ipcRenderer.on('image-cached', listener);
    return () => ipcRenderer.removeListener('image-cached', listener);
  },
  onTraySelectWallpaper: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, wallpaperId) => callback(wallpaperId);
    ipcRenderer.on('tray-select-wallpaper', listener);
    return () => ipcRenderer.removeListener('tray-select-wallpaper', listener);
  },
  getTrayState: () => ipcRenderer.invoke('tray-get-state'),
  traySwitchWallpaper: delta => ipcRenderer.invoke('tray-switch-wallpaper', delta),
  trayShowMainWindow: () => ipcRenderer.send('tray-show-main'),
  trayQuitApp: () => ipcRenderer.send('tray-quit-app'),
  onTrayStateUpdated: callback => {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tray-state-updated', listener);
    return () => ipcRenderer.removeListener('tray-state-updated', listener);
  }
}));
