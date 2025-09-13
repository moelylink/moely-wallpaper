import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { setWallpaper } from 'wallpaper';
import ImageCache from './imageCache.js';

let mainWindow;
let imageCache;
const API_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/moelylink/wallpaper-api/refs/heads/main/wallpaper.json';

// Configure axios with timeout and retry defaults
const axiosConfig = {
  timeout: 10000, // 10 seconds timeout (reduced from 30)
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
  },
  // Force IPv4 to avoid IPv6 connection issues
  family: 4
};

// Retry function for network requests
async function retryRequest(requestFn, maxRetries = 2, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await requestFn();
    } catch (error) {
      console.log(`Request attempt ${i + 1} failed:`, error.message);
      
      if (i === maxRetries - 1) {
        // If all retries failed, return mock data instead of throwing
        console.log('All retry attempts failed, returning mock data');
        return null; // Return null instead of undefined
      }
      
      // Wait before retrying (reduced delay)
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
  });

  // 开发环境下加载 localhost:3000
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // 初始化图片缓存
  imageCache = new ImageCache();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('fetch-wallpapers', async (event) => {
  try {
    const response = await retryRequest(() => axios.get(API_URL, axiosConfig));
    
    // 如果网络请求失败，返回空数组而不是崩溃
    if (!response || !response.data) {
      console.log('No data received, returning empty array');
      return [];
    }
    
    // 转换壁纸数据字段名
    const wallpapers = response.data.map(wp => ({
      id: wp.id,
      artist: wp.user,
      source: wp.category,
      imageUrl: wp.original
    }));
    
    // 检查本地缓存并更新URL
    const wallpapersWithCache = wallpapers.map(wp => {
      const localUrl = imageCache.getLocalImageUrl(wp.imageUrl);
      return {
        ...wp,
        originalUrl: wp.imageUrl, // 保存原始URL
        imageUrl: localUrl || wp.imageUrl, // 优先使用本地缓存
        isLocal: !!localUrl
      };
    });
    
    return wallpapersWithCache;
  } catch (error) {
    console.error('Error fetching wallpapers:', error);
    // 返回空数组而不是抛出错误
    return [];
  }
});

// 图片缓存相关处理程序
ipcMain.handle('cache-images', async (event, wallpapers) => {
  try {
    console.log('Starting image cache process...');
    
    // 使用原始URL进行缓存
    const wallpapersWithOriginalUrl = wallpapers.map(wp => ({
      ...wp,
      imageUrl: wp.originalUrl || wp.imageUrl
    }));
    
    const results = await imageCache.batchDownload(wallpapersWithOriginalUrl, (completed, total) => {
      // 发送进度更新给渲染进程
      mainWindow.webContents.send('cache-progress', { completed, total });
    });
    
    console.log('Image cache process completed');
    return results;
  } catch (error) {
    console.error('Error caching images:', error);
    throw error;
  }
});

ipcMain.handle('get-cache-stats', async (event) => {
  try {
    return imageCache.getCacheStats();
  } catch (error) {
    console.error('Error getting cache stats:', error);
    // 返回默认统计信息而不是抛出错误
    return {
      totalImages: 0,
      cacheSize: 0,
      oldestImage: null,
      newestImage: null
    };
  }
});

ipcMain.handle('clear-cache', async (event) => {
  try {
    imageCache.clearCache();
    return { success: true };
  } catch (error) {
    console.error('Error clearing cache:', error);
    throw error;
  }
});

// Window control handlers
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.restore();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow.close();
});

// Handler for opening URLs in default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external URL:', error);
    return { success: false, error: error.message };
  }
});

// Handler for setting wallpaper
ipcMain.handle('set-wallpaper', async (event, imageData) => {
  try {
    // Validate input data
    if (!imageData) {
      throw new Error('Image data is required');
    }
    
    if (!imageData.id) {
      throw new Error('Image ID is required');
    }
    
    let imagePath = null;
    
    // 如果是本地缓存文件，直接使用本地路径
    if (imageData.isLocal && imageData.originalUrl) {
      const localPath = imageCache.getLocalPath(imageData.originalUrl);
      if (fs.existsSync(localPath)) {
        // Verify the cached file is not empty
        const stats = fs.statSync(localPath);
        if (stats.size > 0) {
          imagePath = localPath;
          console.log(`Using cached image for wallpaper: ${imagePath} (${stats.size} bytes)`);
        } else {
          console.log(`Cached file is empty, will re-download: ${localPath}`);
        }
      }
    }
    
    // 如果没有本地缓存，尝试下载并缓存图片
    if (!imagePath) {
      const imageUrl = imageData.originalUrl || imageData.imageUrl;
      
      // Validate URL before attempting download
      if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
        throw new Error('Invalid image URL: URL is empty or not a string');
      }
      
      // Basic URL validation
      try {
        new URL(imageUrl);
      } catch (urlError) {
        throw new Error(`Invalid image URL format: ${imageUrl}`);
      }
      
      console.log(`Downloading image for wallpaper: ${imageData.id} from ${imageUrl}`);
      
      try {
        imagePath = await imageCache.downloadImage(imageUrl, imageData.id);
        
        // Verify downloaded file exists and is not empty
        if (!fs.existsSync(imagePath)) {
          throw new Error('Downloaded image file does not exist');
        }
        
        const stats = fs.statSync(imagePath);
        if (stats.size === 0) {
          throw new Error('Downloaded image file is empty');
        }
        
        console.log(`Successfully downloaded image: ${imagePath} (${stats.size} bytes)`);
        
      } catch (downloadError) {
        console.error('Failed to download image for wallpaper:', downloadError);
        return { 
          success: false, 
          error: `Failed to download image: ${downloadError.message}` 
        };
      }
    }
    
    // 设置壁纸
    if (imagePath) {
      console.log(`Setting wallpaper: ${imagePath}`);
      
      try {
        await setWallpaper(imagePath);
        
        return { 
          success: true, 
          message: 'Wallpaper set successfully',
          imagePath: imagePath
        };
      } catch (setWallpaperError) {
        console.error('Failed to set wallpaper:', setWallpaperError);
        return {
          success: false,
          error: `Failed to set wallpaper: ${setWallpaperError.message}`
        };
      }
    } else {
      throw new Error('No valid image path found after download attempts');
    }
    
  } catch (error) {
    console.error('Error setting wallpaper:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
});

