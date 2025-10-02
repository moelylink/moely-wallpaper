import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { app } from 'electron';

class ImageCache {
  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'wallpaper-cache');
    this.metadataFile = path.join(this.cacheDir, 'metadata.json');
    this.ensureCacheDir();
  }

  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // 生成基于URL的文件名
  generateFileName(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const ext = path.extname(url).split('?')[0] || '.jpg';
    return `${hash}${ext}`;
  }

  // 获取本地文件路径
  getLocalPath(url) {
    const fileName = this.generateFileName(url);
    return path.join(this.cacheDir, fileName);
  }

  // 检查文件是否存在且完整
  exists(url) {
    const localPath = this.getLocalPath(url);
    if (!fs.existsSync(localPath)) {
      return false;
    }
    
    // 检查文件大小，如果为0字节则认为下载不完整
    try {
      const stats = fs.statSync(localPath);
      if (stats.size === 0) {
        console.log(`Removing empty cached file: ${localPath}`);
        fs.unlinkSync(localPath);
        return false;
      }
      
      // 检查缓存是否过期（7天）
      if (this.isCacheExpired(url)) {
        console.log(`Removing expired cached file: ${localPath}`);
        this.removeExpiredCache(url);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`Error checking file stats:`, error);
      return false;
    }
  }

  // 读取元数据
  readMetadata() {
    try {
      if (fs.existsSync(this.metadataFile)) {
        const data = fs.readFileSync(this.metadataFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error reading metadata:', error);
    }
    return {};
  }

  // 写入元数据
  writeMetadata(metadata) {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error('Error writing metadata:', error);
    }
  }

  // 检查缓存是否过期（7天）
  isCacheExpired(url) {
    const metadata = this.readMetadata();
    const cacheInfo = metadata[url];
    
    if (!cacheInfo || !cacheInfo.downloadTime) {
      return true; // 没有下载时间信息，认为已过期
    }
    
    const downloadTime = new Date(cacheInfo.downloadTime);
    const now = new Date();
    const daysDiff = (now - downloadTime) / (1000 * 60 * 60 * 24);
    
    return daysDiff > 7; // 超过7天认为过期
  }

  // 移除过期的缓存
  removeExpiredCache(url) {
    try {
      const localPath = this.getLocalPath(url);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
      
      // 从元数据中移除
      const metadata = this.readMetadata();
      delete metadata[url];
      this.writeMetadata(metadata);
      
      console.log(`Removed expired cache for: ${url}`);
    } catch (error) {
      console.error(`Error removing expired cache for ${url}:`, error);
    }
  }

  // 清理所有过期缓存
  cleanupExpiredCache() {
    console.log('Starting cleanup of expired cache...');
    const metadata = this.readMetadata();
    let cleanedCount = 0;
    
    for (const url in metadata) {
      if (this.isCacheExpired(url)) {
        this.removeExpiredCache(url);
        cleanedCount++;
      }
    }
    
    console.log(`Cleanup completed. Removed ${cleanedCount} expired cache entries.`);
    return cleanedCount;
  }

  // 下载并缓存图片
  async downloadImage(url, wallpaperId) {
    const localPath = this.getLocalPath(url);
    
    if (this.exists(url)) {
      console.log(`Image already cached: ${wallpaperId}`);
      return localPath;
    }

    try {
      console.log(`Downloading image: ${wallpaperId} from ${url}`);
      
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000, // 30秒超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const writer = fs.createWriteStream(localPath);
      
      return new Promise((resolve, reject) => {
        // 监听响应数据流的错误
        response.data.on('error', (error) => {
          console.error(`Stream error for ${wallpaperId}:`, error);
          writer.destroy();
          // 清理失败的文件
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
          }
          reject(error);
        });

        writer.on('finish', () => {
          console.log(`Image downloaded successfully: ${wallpaperId}`);
          
          // 验证文件大小
          const stats = fs.statSync(localPath);
          if (stats.size === 0) {
            console.error(`Downloaded file is empty: ${wallpaperId}`);
            fs.unlinkSync(localPath);
            reject(new Error('Downloaded file is empty'));
            return;
          }
          
          // 更新元数据
          const metadata = this.readMetadata();
          metadata[url] = {
            id: wallpaperId,
            localPath: localPath,
            downloadTime: new Date().toISOString(),
            originalUrl: url,
            fileSize: stats.size
          };
          this.writeMetadata(metadata);
          
          resolve(localPath);
        });

        writer.on('error', (error) => {
          console.error(`Writer error for ${wallpaperId}:`, error);
          // 清理失败的文件
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
          }
          reject(error);
        });
        
        // 开始管道传输
        response.data.pipe(writer);
      });

    } catch (error) {
      console.error(`Error downloading image ${wallpaperId}:`, error);
      throw error;
    }
  }

  // 获取本地图片URL（file:// protocol）
  getLocalImageUrl(url) {
    const localPath = this.getLocalPath(url);
    if (fs.existsSync(localPath)) {
      return `file://${localPath}`;
    }
    return null;
  }

  // 批量下载壁纸 - 顺序下载，一张一张下
  async batchDownload(wallpapers, progressCallback) {
    const results = [];
    let completed = 0;
    
    console.log(`Starting sequential download of ${wallpapers.length} images...`);
    
    for (const wallpaper of wallpapers) {
      try {
        console.log(`Downloading image ${completed + 1}/${wallpapers.length}: ${wallpaper.id}`);
        
        const localPath = await this.downloadImage(wallpaper.imageUrl, wallpaper.id);
        results.push({
          ...wallpaper,
          localPath: localPath,
          cached: true
        });
        
        console.log(`✓ Successfully downloaded: ${wallpaper.id}`);
      } catch (error) {
        console.error(`✗ Failed to download ${wallpaper.id}:`, error.message);
        results.push({
          ...wallpaper,
          cached: false,
          error: error.message
        });
      }
      
      completed++;
      if (progressCallback) {
        progressCallback(completed, wallpapers.length);
      }
      
      // 在每次下载之间添加小延迟，避免对服务器造成压力
      if (completed < wallpapers.length) {
        console.log(`Waiting 1 second before next download...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Sequential download completed. Success: ${results.filter(r => r.cached).length}/${wallpapers.length}`);
    return results;
  }

  // 清理缓存
  clearCache() {
    try {
      if (fs.existsSync(this.cacheDir)) {
        // 首先尝试删除所有文件
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          const filePath = path.join(this.cacheDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              fs.unlinkSync(filePath);
            }
          } catch (fileError) {
            console.log(`Failed to delete file ${filePath}:`, fileError.message);
            // 跳过无法删除的文件
          }
        }
        
        // 然后重新创建缓存目录
        this.ensureCacheDir();
        console.log('Cache cleared successfully');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      throw error;
    }
  }

  // 获取缓存统计信息
  getCacheStats() {
    const metadata = this.readMetadata();
    const stats = {
      totalImages: Object.keys(metadata).length,
      cacheSize: 0,
      oldestImage: null,
      newestImage: null
    };

    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file !== 'metadata.json') {
            const filePath = path.join(this.cacheDir, file);
            try {
              const stat = fs.statSync(filePath);
              stats.cacheSize += stat.size;
            } catch (fileError) {
              // 跳过无法访问的文件（可能正在使用中）
              console.log(`Skipping file ${file} due to permission error:`, fileError.message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error getting cache stats:', error);
    }

    return stats;
  }
}

export default ImageCache;
