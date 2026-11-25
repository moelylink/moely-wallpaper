import React, { useCallback, useEffect, useRef, useState } from 'react';
import WallpaperViewer from './renderer/components/WallpaperViewer.js';
import ParticleBackground from './renderer/components/ParticleBackground.js';
import TitleBar from './renderer/components/TitleBar.js';
import OnboardingTour from './renderer/components/OnboardingTour.js';
import AnnouncementModal from './renderer/components/AnnouncementModal.js';
import { DEFAULT_THEME_COLOR, applyThemeColorToDocument, normalizeHexColor } from './renderer/utils/themeColor.js';
import Toast from './renderer/components/Toast.js';
import './renderer/styles/App.css';

const api = window.wallpaperAPI;

function App() {
  const [wallpapers, setWallpapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState('tray');
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [notice, setNotice] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const notify = useCallback(options => {
    const id = options?.id ?? ++toastIdRef.current;
    const nextToast = { ...options, id };
    setToasts(previous => {
      const index = previous.findIndex(item => item.id === id);
      if (index !== -1) {
        const updated = [...previous];
        updated[index] = nextToast;
        return updated;
      }
      return [...previous.slice(-3), nextToast];
    });
    return id;
  }, []);

  const dismissToast = useCallback(id => {
    setToasts(previous => previous.filter(item => item.id !== id));
  }, []);

  useEffect(() => {
    if (loading || !wallpapers.length || localStorage.getItem('moely-wallpaper-tour-completed')) return;
    const timer = setTimeout(() => setShowOnboarding(true), 1000);
    return () => clearTimeout(timer);
  }, [loading, wallpapers.length]);

  useEffect(() => {
    let active = true;
    api.fetchNotice().then(data => {
      if (active && data?.contentHash && localStorage.getItem('moely-notice-dismissed-hash') !== data.contentHash) {
        setNotice(data);
      }
    }).catch(error => console.error('Failed to load notice:', error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const requestId = crypto.randomUUID();
    const unsubscribe = api.onImageCached(cached => {
      if (!active) return;
      setWallpapers(previous => previous.map(wallpaper =>
        wallpaper.id === cached.id && wallpaper.originalUrl === cached.originalUrl
          ? { ...wallpaper, imageUrl: cached.imageUrl, isLocal: true }
          : wallpaper
      ));
    });
    const fetchWallpapers = async () => {
      try {
        setLoading(true);
        setError(null);
        // 总时限与重试由主进程统一管理，卸载时发送明确的取消信号。
        const result = await api.fetchWallpapers(requestId);
        if (!active || result.cancelled) return;
        if (!result.success) throw new Error(result.error || '加载失败，请重试');
        setWallpapers(result.wallpapers);
        setWarning(result.warning || '');
        if (!result.offline && result.wallpapers.some(wallpaper => !wallpaper.isLocal)) {
          api.cacheImages().catch(error => {
            if (active) console.error('Background caching failed:', error);
          });
        }
      } catch (error) {
        if (active) setError(error.message || '加载失败，请重试');
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchWallpapers();
    return () => {
      active = false;
      unsubscribe();
      api.cancelFetchWallpapers(requestId);
    };
  }, []);

  const handleAutoStartChange = async enabled => {
    const previous = autoStart;
    setAutoStart(enabled);
    try {
      await api.setAutoStart(enabled);
    } catch (error) {
      setAutoStart(previous);
      notify({ type: 'error', title: '设置开机自启动失败', description: error.message, duration: 5000 });
    }
  };

  const handleCloseBehaviorChange = async behavior => {
    const previous = closeBehavior;
    setCloseBehavior(behavior);
    try {
      await api.setCloseBehavior(behavior);
    } catch (error) {
      setCloseBehavior(previous);
      notify({ type: 'error', title: '设置关闭窗口行为失败', description: error.message, duration: 5000 });
    }
  };

  const handleThemeColorChange = async color => {
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    const previous = themeColor;
    setThemeColor(normalized);
    applyThemeColorToDocument(normalized);
    try {
      await api.setThemeColor(normalized);
    } catch (error) {
      setThemeColor(previous);
      applyThemeColorToDocument(previous);
      notify({ type: 'error', title: '设置主题色失败', description: error.message, duration: 5000 });
    }
  };

  const handleCacheCleared = () => {
    // 不刷新页面，否则启动逻辑会立即重新下载刚刚删除的缓存。
    setWallpapers(previous => previous.map(wallpaper => ({
      ...wallpaper, imageUrl: wallpaper.originalUrl, isLocal: false
    })));
  };

  const handleNoticeDismiss = () => {
    if (notice?.contentHash) localStorage.setItem('moely-notice-dismissed-hash', notice.contentHash);
    setNotice(null);
  };

  useEffect(() => {
    let active = true;
    applyThemeColorToDocument(DEFAULT_THEME_COLOR);
    api.getSettings().then(settings => {
      if (!active) return;
      setAutoStart(settings.autoStart === true);
      setCloseBehavior(settings.closeBehavior === 'exit' ? 'exit' : 'tray');
      const nextColor = applyThemeColorToDocument(settings.themeColor || DEFAULT_THEME_COLOR);
      setThemeColor(nextColor);
    }).catch(error => console.error('Failed to load settings:', error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'F1') {
        event.preventDefault();
        setShowOnboarding(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (typeof api.onFullscreenChange !== 'function') return undefined;
    return api.onFullscreenChange(fullscreen => {
      if (!fullscreen) setIsPreviewFullscreen(false);
    });
  }, []);

  const handleEnterPreview = () => {
    setIsPreviewFullscreen(true);
    api.setFullscreen?.(true)?.catch?.(() => {});
  };

  const handleExitPreview = () => {
    setIsPreviewFullscreen(false);
    api.setFullscreen?.(false)?.catch?.(() => {});
  };

  const toastView = <Toast toasts={toasts} onDismiss={dismissToast} />;

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
        {toastView}
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
            <button className="retry-button" onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
        {toastView}
      </>
    );
  }

  return (
    <>
      {!isPreviewFullscreen && <TitleBar />}
      <div className="App">
        <ParticleBackground themeColor={themeColor} />
        {!isPreviewFullscreen && warning && <div className="network-warning" role="status">{warning}</div>}
        <WallpaperViewer
          wallpapers={wallpapers}
          showSettings={showSettings}
          interactionBlocked={showOnboarding || !!notice}
          setShowSettings={setShowSettings}
          autoStart={autoStart}
          handleAutoStartChange={handleAutoStartChange}
          closeBehavior={closeBehavior}
          handleCloseBehaviorChange={handleCloseBehaviorChange}
          themeColor={themeColor}
          handleThemeColorChange={handleThemeColorChange}
          isPreviewFullscreen={isPreviewFullscreen}
          onEnterPreview={handleEnterPreview}
          onExitPreview={handleExitPreview}
          onCacheCleared={handleCacheCleared}
          onNotify={notify}
        />
        {showOnboarding && <OnboardingTour onComplete={() => setShowOnboarding(false)} />}
        {notice && !showOnboarding && <AnnouncementModal notice={notice} onDismiss={handleNoticeDismiss} />}
      </div>
      {toastView}
    </>
  );
}

export default App;
