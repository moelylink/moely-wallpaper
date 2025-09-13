import React, { useEffect, useState } from 'react';
import WallpaperViewer from './renderer/components/WallpaperViewer.js';
import ParticleBackground from './renderer/components/ParticleBackground.js';
import TitleBar from './renderer/components/TitleBar.js';
import OnboardingTour from './renderer/components/OnboardingTour.js';
import './renderer/styles/App.css';

const { ipcRenderer } = window.require('electron');

function App() {
  const [wallpapers, setWallpapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cacheProgress, setCacheProgress] = useState({ completed: 0, total: 0 });
  const [isCaching, setIsCaching] = useState(false);
  const [showCachePanel, setShowCachePanel] = useState(false);
  const [cacheStats, setCacheStats] = useState({ totalImages: 0, cacheSize: 0 });
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 检查是否首次使用
  useEffect(() => {
    const isFirstTime = !localStorage.getItem('moely-wallpaper-tour-completed');
    if (isFirstTime) {
      // 延迟显示新手引导，等待UI加载完成
      const timer = setTimeout(() => {
        setShowOnboarding(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [wallpapers]); // 依赖wallpapers，确保数据加载完成后才显示引导

  useEffect(() => {
    const fetchWallpapers = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // 添加超时处理
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('请求超时，请检查网络连接')), 15000);
        });
        
        const dataPromise = ipcRenderer.invoke('fetch-wallpapers');
        const data = await Promise.race([dataPromise, timeoutPromise]);
        
        setWallpapers(data);
        
        // 后台静默缓存未缓存的图片
        const uncachedWallpapers = data.filter(wp => !wp.isLocal);
        if (uncachedWallpapers.length > 0) {
          console.log(`Found ${uncachedWallpapers.length} uncached images, starting silent cache process...`);
          startSilentImageCaching(uncachedWallpapers);
        }
        
      } catch (err) {
        console.error('Error fetching wallpapers:', err);
        setError(err.message || '加载失败，请重试');
      } finally {
        setLoading(false);
      }
    };

    fetchWallpapers();
  }, []);

  // 后台静默缓存图片
  const startSilentImageCaching = async (wallpapersToCache) => {
    try {
      console.log('Starting silent background caching...');
      
      const results = await ipcRenderer.invoke('cache-images', wallpapersToCache);
      
      // 静默更新wallpapers状态，使用本地缓存的图片
      setWallpapers(prevWallpapers => {
        return prevWallpapers.map(wp => {
          const cachedResult = results.find(r => r.id === wp.id);
          if (cachedResult && cachedResult.cached) {
            return {  
              ...wp,
              imageUrl: `file://${cachedResult.localPath}`,
              isLocal: true
            };
          }
          return wp;
        });
      });
      
      console.log('Silent caching completed');
    } catch (err) {
      console.error('Error in silent caching:', err);
    }
  };

  // 获取缓存统计信息
  const loadCacheStats = async () => {
    try {
      const stats = await ipcRenderer.invoke('get-cache-stats');
      setCacheStats(stats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  };

  // 清理缓存
  const handleClearCache = async () => {
    try {
      setIsClearingCache(true);
      await ipcRenderer.invoke('clear-cache');
      
      // 刷新缓存统计
      await loadCacheStats();
      
      // 重新加载壁纸数据，强制重新下载
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear cache:', error);
      alert('清理缓存失败：' + error.message);
    } finally {
      setIsClearingCache(false);
    }
  };

  // 打开/关闭缓存面板
  const toggleCachePanel = async () => {
    if (!showCachePanel) {
      await loadCacheStats();
    }
    setShowCachePanel(!showCachePanel);
  };

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 新手引导完成处理
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    console.log('新手引导完成');
  };

  // 手动显示新手引导（用于调试或重新查看）
  const showTourManually = () => {
    setShowOnboarding(true);
  };

  // 监听缓存进度
  useEffect(() => {
    const handleCacheProgress = (event, progress) => {
      setCacheProgress(progress);
    };

    ipcRenderer.on('cache-progress', handleCacheProgress);

    return () => {
      ipcRenderer.removeListener('cache-progress', handleCacheProgress);
    };
  }, []);

  // 监听键盘事件，支持快捷键重新显示引导
  useEffect(() => {
    const handleKeyDown = (e) => {
      // F1 键显示新手引导
      if (e.key === 'F1') {
        e.preventDefault();
        showTourManually();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <>
        <TitleBar />
        <div className="App">
          <ParticleBackground />
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <div className="loading-text">正在加载壁纸数据...</div>
            <div className="loading-subtitle">首次加载可能需要较长时间</div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TitleBar />
        <div className="App">
          <ParticleBackground />
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <div className="error-text">加载失败</div>
            <div className="error-message">{error}</div>
            <button 
              className="retry-button" 
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TitleBar />
      <div className="App">
        <ParticleBackground />
        <WallpaperViewer wallpapers={wallpapers} />

        {/* 新手引导组件 */}
        {showOnboarding && (
          <OnboardingTour onComplete={handleOnboardingComplete} />
        )}
        
        {/* 缓存管理按钮 */}
        <button 
          className="cache-manager-toggle"
          onClick={toggleCachePanel}
          title="缓存管理"
        >
          <span className="cache-icon">💾</span>
        </button>
        
        {/* 缓存管理面板 */}
        {showCachePanel && (
          <div className="cache-panel-overlay" onClick={() => setShowCachePanel(false)}>
            <div className="cache-panel" onClick={(e) => e.stopPropagation()}>
              <div className="cache-panel-header">
                <h3>缓存管理</h3>
                <button 
                  className="close-button"
                  onClick={() => setShowCachePanel(false)}
                >
                  ×
                </button>
              </div>
              
              <div className="cache-panel-content">
                <div className="cache-stats">
                  <div className="stat-item">
                    <span className="stat-label">缓存数量：</span>
                    <span className="stat-value">{cacheStats.totalImages} 张</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">缓存大小：</span>
                    <span className="stat-value">{formatFileSize(cacheStats.cacheSize)}</span>
                  </div>
                </div>
                
                <div className="cache-actions">
                  <button 
                    className="clear-cache-button"
                    onClick={handleClearCache}
                    disabled={isClearingCache}
                  >
                    {isClearingCache ? (
                      <>
                        <span className="loading-spinner-small"></span>
                        清理中...
                      </>
                    ) : (
                      <>
                        <span className="clear-icon">🧹</span>
                        一键清理缓存
                      </>
                    )}
                  </button>
                  
                  <button 
                    className="refresh-stats-button"
                    onClick={loadCacheStats}
                  >
                    <span className="refresh-icon">🔄</span>
                    刷新统计
                  </button>
                </div>
                
                <div className="cache-help">
                  <p>💡 清理缓存将删除所有本地图片文件，下次查看时需要重新下载。</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default App;
