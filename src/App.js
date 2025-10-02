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
  const [showSettings, setShowSettings] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
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

  // 切换设置面板
  const toggleSettings = () => {
    setShowSettings(!showSettings);
  };

  // 处理开机自启动开关
  const handleAutoStartChange = async (enabled) => {
    try {
      setAutoStart(enabled);
      await ipcRenderer.invoke('set-auto-start', enabled);
    } catch (error) {
      console.error('Failed to set auto start:', error);
      alert('设置开机自启动失败：' + error.message);
    }
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

  // 加载设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await ipcRenderer.invoke('get-settings');
        setAutoStart(settings.autoStart !== false); // 默认开启
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
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
        <WallpaperViewer 
          wallpapers={wallpapers} 
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          autoStart={autoStart}
          handleAutoStartChange={handleAutoStartChange}
        />

        {/* 新手引导组件 */}
        {showOnboarding && (
          <OnboardingTour onComplete={handleOnboardingComplete} />
        )}
        
      </div>
    </>
  );
}

export default App;
