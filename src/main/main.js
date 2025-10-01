import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { setWallpaper } from 'wallpaper';
import { spawn } from 'child_process';
import ImageCache from './imageCache.js';
import AutoLaunch from 'auto-launch';

let mainWindow;
let imageCache;
let autoLauncher;
const API_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/moelylink/wallpaper-api/refs/heads/main/wallpaper.json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 自定义壁纸设置函数，处理打包环境中的路径问题
const setWallpaperCustom = async (imagePath) => {
  try {
    // 首先尝试使用 wallpaper 包的标准方法
    await setWallpaper(imagePath);
    return { success: true, method: 'wallpaper-package' };
  } catch (error) {
    console.log('Standard wallpaper package failed, trying custom method:', error.message);
    
    // 如果标准方法失败，尝试直接调用可执行文件
    try {
      // 在打包环境中，wallpaper 包的可执行文件应该在 app.asar.unpacked 目录中
      const isPackaged = app.isPackaged;
      let wallpaperExePath;
      
      if (isPackaged) {
        // 打包环境：可执行文件在 app.asar.unpacked 目录中
        wallpaperExePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'wallpaper', 'source', 'windows-wallpaper-x86-64.exe');
      } else {
        // 开发环境：可执行文件在 node_modules 目录中
        wallpaperExePath = path.join(__dirname, '..', '..', 'node_modules', 'wallpaper', 'source', 'windows-wallpaper-x86-64.exe');
      }
      
      console.log('Attempting to use wallpaper executable:', wallpaperExePath);
      console.log('File exists:', fs.existsSync(wallpaperExePath));
      
      if (!fs.existsSync(wallpaperExePath)) {
        throw new Error(`Wallpaper executable not found at: ${wallpaperExePath}`);
      }
      
      // 使用 spawn 调用可执行文件
      return new Promise((resolve, reject) => {
        const child = spawn(wallpaperExePath, ['set', imagePath]);
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('Custom wallpaper setting successful');
            resolve({ success: true, method: 'custom-executable', stdout, stderr });
          } else {
            console.error('Custom wallpaper setting failed with code:', code);
            reject(new Error(`Wallpaper executable failed with code ${code}: ${stderr}`));
          }
        });
        
        child.on('error', (error) => {
          console.error('Error spawning wallpaper executable:', error);
          reject(error);
        });
      });
    } catch (customError) {
      console.error('Custom wallpaper method also failed:', customError);
      throw new Error(`Both wallpaper methods failed. Standard: ${error.message}, Custom: ${customError.message}`);
    }
  }
};

// 初始化开机自启动
const initAutoLaunch = () => {
  autoLauncher = new AutoLaunch({
    name: '萌哩壁纸',
    path: process.execPath,
    isHidden: true
  });
};

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
  // 初始化开机自启动
  initAutoLaunch();
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

// 设置相关处理程序
ipcMain.handle('get-settings', async (event) => {
  try {
    // 检查开机自启动状态
    const isEnabled = await autoLauncher.isEnabled();
    return {
      autoStart: isEnabled
    };
  } catch (error) {
    console.error('Error getting settings:', error);
    return {
      autoStart: true // 默认开启
    };
  }
});

ipcMain.handle('set-auto-start', async (event, enabled) => {
  try {
    if (enabled) {
      await autoLauncher.enable();
    } else {
      await autoLauncher.disable();
    }
    return { success: true };
  } catch (error) {
    console.error('Error setting auto start:', error);
    throw error;
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
        const result = await setWallpaperCustom(imagePath);
        
        return { 
          success: true, 
          message: 'Wallpaper set successfully',
          imagePath: imagePath,
          method: result.method
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

