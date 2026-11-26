import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './WallpaperViewer.css';
import useWallpaperImages from '../hooks/useWallpaperImages.js';
import WallpaperImage from './WallpaperImage.js';
import Toast from './Toast.js';
import WallpaperEditorModal from './WallpaperEditorModal.js';
import WallpaperPreviewOverlay from './WallpaperPreviewOverlay.js';
import { DEFAULT_THEME_COLOR, PRESET_THEME_COLORS } from '../utils/themeColor.js';

const api = window.wallpaperAPI;
const isInteractiveTarget = target => !!target?.closest?.(
  'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .app-toast'
);

const WallpaperViewer = ({
  wallpapers, showSettings, setShowSettings, autoStart, handleAutoStartChange,
  silentStart = false, handleSilentStartChange,
  autoUpdate = true, handleAutoUpdateChange,
  closeBehavior = 'tray', handleCloseBehaviorChange,
  themeColor = DEFAULT_THEME_COLOR, handleThemeColorChange,
  isPreviewFullscreen = false, onEnterPreview, onExitPreview,
  onCacheCleared, onNotify, interactionBlocked = false
}) => {
  const [selectedIndex, setCurrentIndex] = useState(0);
  const displayWallpapers = useMemo(() => wallpapers.slice(0, 8), [wallpapers]);
  const currentIndex = Math.min(selectedIndex, Math.max(0, displayWallpapers.length - 1));
  const { imageCache, preloadImages, retryLoadImage, markImageLoaded, markImageError } = useWallpaperImages(wallpapers);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isNewImage = false;
  const [, setSlideDirection] = useState('');
  const [animatingItems, setAnimatingItems] = useState({});
  const [isSettingWallpaper, setIsSettingWallpaper] = useState(false);
  const [toast, setToast] = useState(null);
  const toastIdRef = useRef(0);
  const viewerRef = useRef(null);
  const [showEditor, setShowEditor] = useState(false);
  const [localPreview, setLocalPreview] = useState(false);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState(null);
  const [updateState, setUpdateState] = useState(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const promptedVersionRef = useRef(null);
  const previewActive = onEnterPreview ? isPreviewFullscreen : localPreview;
  const interactionsBlocked = showSettings || showEditor || showUpdatePrompt || previewActive || interactionBlocked;
  const [autoSetWallpaper, setAutoSetWallpaper] = useState(false);
  const [lastAutoSetId, setLastAutoSetId] = useState(null);
  const settingRef = useRef(false);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Set());
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  
  const schedule = useCallback((callback, delay) => {
    if (!mountedRef.current) return null;
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      if (mountedRef.current) callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const cancelTimer = useCallback(timer => {
    clearTimeout(timer);
    timersRef.current.delete(timer);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const notify = useCallback(options => {
    if (!mountedRef.current) return null;
    if (typeof onNotify === 'function') return onNotify(options);
    const id = options?.id ?? ++toastIdRef.current;
    setToast({ ...options, id });
    return id;
  }, [onNotify]);
  const dismissToast = useCallback(id => {
    setToast(previous => previous?.id === id ? null : previous);
  }, []);

  // 提示绑定操作开始时的壁纸，而不是异步完成时正在浏览的图片。
  const handleSetWallpaper = useCallback(async (wallpaper, isAuto = false) => {
    if (!wallpaper || settingRef.current) return;
    settingRef.current = true;
    setIsSettingWallpaper(true);
    const description = `壁纸 ${wallpaper.id}${wallpaper.artist ? ` · ${wallpaper.artist}` : ''}`;
    const toastId = notify({ type: 'loading', title: isAuto ? '正在自动设置壁纸' : '正在设置壁纸', description, duration: 0 });
    if (isAuto) setLastAutoSetId(wallpaper.id);
    try {
      const result = await api.setWallpaper(wallpaper.id);
      if (!mountedRef.current) return;
      if (!result.success) throw new Error(result.error || '设置失败');
      notify({ id: toastId, type: 'success', title: isAuto ? '自动设置壁纸成功' : '壁纸设置成功', description });
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAuto) setAutoSetWallpaper(false);
      notify({
        id: toastId, type: 'error', title: isAuto ? '自动设置失败，已暂停' : '壁纸设置失败',
        description: `${description}
${error.message}`, duration: 6000
      });
    } finally {
      settingRef.current = false;
      if (mountedRef.current) setIsSettingWallpaper(false);
    }
  }, [notify]);

  const openPreview = useCallback(() => {
    if (onEnterPreview) onEnterPreview();
    else setLocalPreview(true);
  }, [onEnterPreview]);

  const closePreview = useCallback(() => {
    setEditedPreviewUrl(null);
    if (onExitPreview) onExitPreview();
    else setLocalPreview(false);
  }, [onExitPreview]);

  const handlePreviewEdited = useCallback(dataUrl => {
    setEditedPreviewUrl(dataUrl);
    openPreview();
  }, [openPreview]);

  const handleApplyEditedWallpaper = useCallback(async payload => {
    const wallpaper = displayWallpapers[currentIndex];
    if (!wallpaper || settingRef.current) return;
    settingRef.current = true;
    setIsSettingWallpaper(true);
    const description = `编辑版壁纸 ${wallpaper.id}`;
    const toastId = notify({ type: 'loading', title: '正在应用编辑壁纸', description, duration: 0 });
    try {
      const result = await api.setEditedWallpaper(payload, wallpaper.id);
      if (!mountedRef.current) return;
      if (!result?.success) throw new Error(result?.error || '设置失败');
      notify({ id: toastId, type: 'success', title: '编辑壁纸设置成功', description });
      setShowEditor(false);
    } catch (error) {
      if (!mountedRef.current) return;
      notify({ id: toastId, type: 'error', title: '编辑壁纸设置失败', description: `${description}\n${error.message}`, duration: 6000 });
    } finally {
      settingRef.current = false;
      if (mountedRef.current) setIsSettingWallpaper(false);
    }
  }, [displayWallpapers, currentIndex, notify]);

  const handleSaveEditedWallpaper = useCallback(async payload => {
    try {
      const result = await api.saveEditedWallpaper(payload);
      if (!mountedRef.current || result?.cancelled) return;
      if (!result?.success) throw new Error(result?.error || '保存失败');
      notify({ type: 'success', title: '壁纸已另存为', description: result.filePath || '' });
    } catch (error) {
      if (!mountedRef.current) return;
      notify({ type: 'error', title: '保存编辑壁纸失败', description: error.message, duration: 6000 });
    }
  }, [notify]);

  // 清除缓存功能
  const handleClearCache = async () => {
    if (isClearingCache) return;
    setIsClearingCache(true);
    setAutoSetWallpaper(false);
    setLastAutoSetId(null);
    const toastId = notify({ type: 'loading', title: '正在清除缓存', duration: 0 });
    try {
      const result = await api.clearCache();
      if (!mountedRef.current) return;
      if (result.success) {
        notify({
          id: toastId,
          type: 'success',
          title: '缓存清除成功',
          description: `已删除 ${result.clearedCount} 个文件`,
          duration: 4000
        });
        onCacheCleared();
      } else {
        notify({ id: toastId, type: 'error', title: '清除缓存失败', description: result.error || '请稍后重试', duration: 5000 });
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      if (mountedRef.current) {
        notify({ id: toastId, type: 'error', title: '清除缓存失败', description: error.message || '清除缓存时发生错误', duration: 5000 });
      }
    } finally {
      if (mountedRef.current) setIsClearingCache(false);
    }
  };

  // 订阅自动更新状态，安装包就绪后弹出安装提示
  useEffect(() => {
    const applyUpdateState = nextState => {
      if (!mountedRef.current || !nextState) return;
      setUpdateState(nextState);
      if (
        nextState.status === 'downloaded' &&
        nextState.latestVersion &&
        promptedVersionRef.current !== nextState.latestVersion
      ) {
        promptedVersionRef.current = nextState.latestVersion;
        setShowUpdatePrompt(true);
      }
    };

    api?.getUpdateState?.().then(applyUpdateState).catch(() => {});
    const unsubscribe = api?.onUpdateStatus?.(applyUpdateState);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // 检查更新功能
  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    if (updateState?.status === 'downloaded' && updateState?.latestVersion) {
      setShowUpdatePrompt(true);
      return;
    }
    setIsCheckingUpdate(true);
    const toastId = notify({ type: 'loading', title: '正在检查更新', duration: 0 });
    try {
      const result = api.downloadUpdate ? await api.downloadUpdate() : await api.checkUpdate();
      if (!mountedRef.current) return;
      if (result.success) {
        if (result.hasUpdate) {
          if (result.installerPath) {
            notify({
              id: toastId,
              type: 'success',
              title: `新版本 ${result.latestVersion} 已下载`,
              description: '请在弹出窗口确认安装',
              duration: 4000
            });
            setShowUpdatePrompt(true);
          } else {
            notify({
              id: toastId,
              type: 'info',
              title: `发现新版本 ${result.latestVersion}`,
              description: `当前版本 ${result.currentVersion}，即将打开下载链接`,
              duration: 5000
            });
            schedule(() => {
              api.openExternal(result.updateUrl).catch(console.error);
            }, 2000);
          }
        } else {
          notify({ id: toastId, type: 'success', title: '已是最新版本', duration: 3000 });
        }
      } else {
        notify({ id: toastId, type: 'error', title: '检查更新失败', description: result.error || '请稍后重试', duration: 5000 });
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      if (mountedRef.current) {
        notify({ id: toastId, type: 'error', title: '检查更新失败', description: error.message || '检查更新时发生错误', duration: 5000 });
      }
    } finally {
      if (mountedRef.current) setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    try {
      const result = await api.installUpdate?.();
      if (!mountedRef.current) return;
      if (result && result.success === false) {
        notify({
          type: 'error',
          title: '启动安装程序失败',
          description: result.error || '请尝试手动前往官网下载更新',
          duration: 5000
        });
        setIsInstallingUpdate(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        notify({
          type: 'error',
          title: '启动安装程序失败',
          description: error?.message || '请稍后重试',
          duration: 5000
        });
        setIsInstallingUpdate(false);
      }
    }
  };

  // 按壁纸 ID 记录尝试；切换失败不会无限触发相同操作。
  useEffect(() => {
    const wallpaper = displayWallpapers[currentIndex];
    if (interactionsBlocked || !autoSetWallpaper || !wallpaper || wallpaper.id === lastAutoSetId || isSettingWallpaper || isClearingCache) return;
    const timer = schedule(() => {
      if (imageCache[wallpaper.id] !== 'error') handleSetWallpaper(wallpaper, true);
    }, 1000);
    return () => cancelTimer(timer);
  }, [currentIndex, autoSetWallpaper, lastAutoSetId, displayWallpapers, imageCache, isSettingWallpaper, isClearingCache, handleSetWallpaper, schedule, cancelTimer, interactionsBlocked]);

  const toggleAutoSetWallpaper = () => {
    setAutoSetWallpaper(previous => !previous);
    setLastAutoSetId(null);
    notify({ type: 'info', title: autoSetWallpaper ? '已关闭自动壁纸' : '已开启自动壁纸', duration: 2500 });
  };

  useEffect(() => {
    setCurrentIndex(previous => Math.min(previous, Math.max(0, displayWallpapers.length - 1)));
  }, [displayWallpapers.length]);

  useEffect(() => {
    if (typeof api.onTraySelectWallpaper !== 'function') return undefined;
    return api.onTraySelectWallpaper(wallpaperId => {
      const targetIdx = displayWallpapers.findIndex(item => item.id === wallpaperId);
      if (targetIdx !== -1) setCurrentIndex(targetIdx);
    });
  }, [displayWallpapers]);

  useEffect(() => {
    if (!displayWallpapers.length) return;
    const length = displayWallpapers.length;
    preloadImages([
      displayWallpapers[currentIndex],
      displayWallpapers[(currentIndex + 1) % length],
      displayWallpapers[(currentIndex + length - 1) % length]
    ].filter(Boolean));
  }, [displayWallpapers, currentIndex, preloadImages]);

  // 优化的横向滚动切换函数 - 缩短滑动路径和时间
  const handlePrevious = useCallback(() => {
    if (interactionsBlocked || isTransitioning || displayWallpapers.length < 2) return;
    setIsTransitioning(true);
    setSlideDirection('right'); // 向右滑动显示上一张
    
    const prevIdx = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
    const nextIdx = (currentIndex + 1) % displayWallpapers.length;
    
    // 优化：使用更短的动画路径和时间
    setAnimatingItems({
      [prevIdx]: 'fast-slide-to-center-from-left',     // 左边图片快速移到中间
      [currentIndex]: 'fast-slide-to-right-from-center', // 当前图片快速移到右边
      [nextIdx]: 'fast-slide-to-left-from-right'       // 右边图片快速移到左边
    });
    
    // 缩短延迟时间
    schedule(() => {
      setCurrentIndex(prevIdx);
    }, 25);
    
    // 总动画时间28ms
    schedule(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 280);
  }, [displayWallpapers.length, isTransitioning, currentIndex, schedule, interactionsBlocked]);

  // 优化的横向滚动切换函数 - 缩短滑动路径和时间
  const handleNext = useCallback(() => {
    if (interactionsBlocked || isTransitioning || displayWallpapers.length < 2) return;
    setIsTransitioning(true);
    setSlideDirection('left'); // 向左滑动显示下一张
    
    const prevIdx = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
    const nextIdx = (currentIndex + 1) % displayWallpapers.length;
    
    // 优化：使用更短的动画路径和时间
    setAnimatingItems({
      [prevIdx]: 'fast-slide-to-right-from-left',     // 左边图片快速移到右边
      [currentIndex]: 'fast-slide-to-left-from-center', // 当前图片快速移到左边
      [nextIdx]: 'fast-slide-to-center-from-right'    // 右边图片快速移到中间
    });
    
    // 缩短延迟时间
    schedule(() => {
      setCurrentIndex(nextIdx);
    }, 25);
    
    // 缩短总动画时间从450ms到280ms
    schedule(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 280);
  }, [displayWallpapers.length, isTransitioning, currentIndex, schedule, interactionsBlocked]);

  // 优化的直接跳转函数 - 使用快速淡入淡出效果
  const handleIndicatorClick = useCallback((index) => {
    if (interactionsBlocked || isTransitioning || index === currentIndex) return;
    setIsTransitioning(true);
    
    // 使用快速淡入淡出效果，避免复杂滑动
    setAnimatingItems({
      [currentIndex]: 'fast-fade-out'
    });
    
    schedule(() => {
      setCurrentIndex(index);
      
      // 设置新图片的快速淡入动画
      setAnimatingItems({
        [index]: 'fast-fade-in'
      });
    }, 100);
    
    // 缩短总动画时间到200ms
    schedule(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 200);
  }, [currentIndex, isTransitioning, schedule, interactionsBlocked]);

  useEffect(() => {
    if (interactionsBlocked) return;
    const handleKeyPress = event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isInteractiveTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlePrevious();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handlePrevious, handleNext, interactionsBlocked]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || interactionsBlocked) return;
    let wheelTimeout = null;
    const handleWheel = event => {
      if (event.defaultPrevented || isInteractiveTarget(event.target) || Math.abs(event.deltaY) <= 50) return;
      event.preventDefault();
      cancelTimer(wheelTimeout);
      const direction = event.deltaY;
      wheelTimeout = schedule(() => {
        if (direction > 0) handleNext();
        else handlePrevious();
      }, 50);
    };
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      cancelTimer(wheelTimeout);
      viewer.removeEventListener('wheel', handleWheel);
    };
  }, [handlePrevious, handleNext, interactionsBlocked, schedule, cancelTimer]);

  const toastView = typeof onNotify === 'function'
    ? null
    : <Toast key={toast?.id ?? 'empty'} toast={toast} onDismiss={dismissToast} />;
  if (!displayWallpapers.length) {
    return <><div className="no-wallpapers">暂无壁纸数据</div>{toastView}</>;
  }

  const currentWallpaper = displayWallpapers[currentIndex];
  const prevIndex = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
  const nextIndex = (currentIndex + 1) % displayWallpapers.length;
  const prevWallpaper = displayWallpapers[prevIndex];
  const nextWallpaper = displayWallpapers[nextIndex];

  return (
    <>
    <div className="wallpaper-viewer" ref={viewerRef}>
      <div className={`wallpaper-container ${isTransitioning ? 'transitioning' : ''}`}>
        {/* 3D轮播容器 */}
        <div className="carousel-3d-container">
          {displayWallpapers.length > 1 && (
            <button
              type="button"
              className={`nav-button nav-button-left${isTransitioning ? ' disabled' : ''}`}
              onClick={handlePrevious}
              disabled={isTransitioning}
              aria-label="上一张壁纸"
              title="上一张"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {displayWallpapers.length > 1 && (
            <div className={`carousel-item carousel-prev ${animatingItems[prevIndex] || ''}`} onClick={handlePrevious}>
              <WallpaperImage
                wallpaper={prevWallpaper}
                error={imageCache[prevWallpaper.id] === 'error'}
                onLoad={markImageLoaded}
                onError={markImageError}
                onRetry={retryLoadImage}
              />
            </div>
          )}
          <div className={`carousel-item carousel-current ${isNewImage ? 'new-image' : ''} ${animatingItems[currentIndex] || ''}`}>
            <WallpaperImage
              wallpaper={currentWallpaper}
              error={imageCache[currentWallpaper.id] === 'error'}
              onLoad={markImageLoaded}
              onError={markImageError}
              onRetry={retryLoadImage}
            />
            <div className="current-card-actions" onClick={event => event.stopPropagation()}>
              <button
                type="button"
                className="card-action-btn edit-wallpaper-button"
                onClick={() => setShowEditor(true)}
                disabled={isSettingWallpaper}
                title="编辑壁纸"
                aria-label="编辑壁纸"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 20H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M16.5 3.5A2.121 2.121 0 1 1 19.5 6.5L7 19L3 20L4 16L16.5 3.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>编辑</span>
              </button>
              <button
                type="button"
                className="card-action-btn preview-wallpaper-button"
                onClick={openPreview}
                title="全屏预览壁纸效果"
                aria-label="全屏预览壁纸效果"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M15 3H21V9M9 21H3V15M21 3L14 10M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>预览</span>
              </button>
            </div>
          </div>
          {displayWallpapers.length > 1 && (
            <div className={`carousel-item carousel-next ${animatingItems[nextIndex] || ''}`} onClick={handleNext}>
              <WallpaperImage
                wallpaper={nextWallpaper}
                error={imageCache[nextWallpaper.id] === 'error'}
                onLoad={markImageLoaded}
                onError={markImageError}
                onRetry={retryLoadImage}
              />
            </div>
          )}
          {displayWallpapers.length > 1 && (
            <button
              type="button"
              className={`nav-button nav-button-right${isTransitioning ? ' disabled' : ''}`}
              onClick={handleNext}
              disabled={isTransitioning}
              aria-label="下一张壁纸"
              title="下一张"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="viewer-bottom-bar">
        {/* 壁纸信息 */}
        <div className="wallpaper-info">
          <div className="info-item">
            <span className="info-label">ID:</span>
            <span className="info-value">{currentWallpaper.id}</span>
          </div>
          <div className="info-item">
            <span className="info-label">画师:</span>
            <span className="info-value">{currentWallpaper.artist}</span>
          </div>
          <div className="info-item">
            <span className="info-label">来源:</span>
            <span className="info-value">{currentWallpaper.source}</span>
          </div>
        </div>

        {/* 指示器 */}
        <div className="indicator-container">
          {displayWallpapers.map((_, index) => (
            <span 
              key={index} 
              className={`indicator ${index === currentIndex ? 'active' : ''} ${isTransitioning ? 'disabled' : ''}`}
              onClick={() => handleIndicatorClick(index)}
            />
          ))}
        </div>

        {/* 在萌哩打开按钮 - 右下角 */}
        <div className="moely-link-container">
          <button 
            className="moely-link-button"
            onClick={() => api.openExternal(`https://www.moely.link/img/${encodeURIComponent(currentWallpaper.id)}/`)}
            title="在萌哩打开"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '6px'}}>
              <path d="M10 6V8H5V19H16V14H18V19C18 20.1 17.1 21 16 21H5C3.9 21 3 20.1 3 19V8C3 6.9 3.9 6 5 6H10Z" fill="currentColor"/>
              <path d="M21 3H15V5H18.59L9.76 13.83L11.17 15.24L20 6.41V10H22V3C22 2.45 21.55 2 21 2V3Z" fill="currentColor"/>
            </svg>
            在萌哩打开
          </button>
        </div>
      </div>

      {/* 控制按钮组 */}
      <div className="control-buttons">
        {/* 设置按钮 */}
        <button 
          className="settings-button"
          onClick={() => setShowSettings(true)}
          title="设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '6px'}}>
            <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z" fill="currentColor"/>
          </svg>
          设置
        </button>
        
        {/* 设为壁纸按钮 */}
        <button 
          className="set-wallpaper-button"
          onClick={() => handleSetWallpaper(currentWallpaper)}
          disabled={isSettingWallpaper}
          title="设为壁纸"
        >
          {isSettingWallpaper ? (
            <>
              <div className="button-spinner"></div>
              设置中...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '6px'}}>
                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" fill="currentColor"/>
                <path d="M10.5 12.5l2.5 2.5 6-6L18 8l-5 5-1.5-1.5-1 1z" fill="currentColor"/>
              </svg>
              设为壁纸
            </>
          )}
        </button>
        
        {/* 自动设置壁纸切换按钮 */}
        <button 
          className={`auto-wallpaper-button ${autoSetWallpaper ? 'active' : ''}`}
          onClick={toggleAutoSetWallpaper}
          title={autoSetWallpaper ? '关闭自动设置壁纸' : '开启自动设置壁纸'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '6px'}}>
            {autoSetWallpaper ? (
              /* 开启状态图标 */
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8l-9 9z" fill="currentColor"/>
            ) : (
              /* 关闭状态图标 */
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm5 11H7v-2h10v2z" fill="currentColor"/>
            )}
          </svg>
          {autoSetWallpaper ? '自动壁纸：开' : '自动壁纸：关'}
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="settings-panel-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
            <div className="settings-panel-header">
              <h3 id="settings-title">设置</h3>
              <button 
                className="close-button"
                onClick={() => setShowSettings(false)}
              >
                ×
              </button>
            </div>
            
            <div className="settings-panel-content">
              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title">开机自启动</span>
                  <span className="setting-description">开机时自动启动萌哩壁纸</span>
                </div>
                <div className="setting-control">
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={autoStart}
                      onChange={(e) => handleAutoStartChange(e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              {autoStart && (
                <div className="setting-item">
                  <div className="setting-label">
                    <span className="setting-title">静默启动</span>
                    <span className="setting-description">开机自启时仅驻留系统托盘，不弹出主窗口</span>
                  </div>
                  <div className="setting-control">
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label="静默启动"
                        checked={silentStart}
                        onChange={(e) => handleSilentStartChange?.(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              )}

              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title">关闭窗口</span>
                  <span className="setting-description">点击关闭按钮时的默认行为</span>
                </div>
                <div className="setting-control">
                  <div className="close-behavior-group" role="radiogroup" aria-label="关闭窗口行为">
                    {[
                      { value: 'tray', label: '缩小到托盘' },
                      { value: 'exit', label: '退出程序' }
                    ].map(option => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={closeBehavior === option.value}
                        className={`close-behavior-option${closeBehavior === option.value ? ' active' : ''}`}
                        onClick={() => handleCloseBehaviorChange?.(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title setting-title-row">
                    <span>主题色</span>
                    <span className="theme-color-hex">{themeColor.toUpperCase()}</span>
                  </span>
                  <span className="setting-description">自定义界面高亮与背景粒子颜色</span>
                </div>
                <div className="setting-control">
                  <div className="theme-color-picker" role="group" aria-label="主题色选择">
                    {PRESET_THEME_COLORS.map(preset => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`theme-swatch${themeColor === preset.value ? ' active' : ''}`}
                        style={{ backgroundColor: preset.value }}
                        title={preset.name}
                        aria-label={preset.name}
                        aria-pressed={themeColor === preset.value}
                        onClick={() => handleThemeColorChange?.(preset.value)}
                      />
                    ))}
                    <label className="theme-custom-input" title="自定义颜色">
                      <input
                        type="color"
                        aria-label="自定义主题色"
                        value={themeColor}
                        onChange={event => handleThemeColorChange?.(event.target.value)}
                      />
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 3C7.03 3 3 6.58 3 11C3 13.4 4.19 15.56 6.08 17.02C6.59 17.42 6.84 18.08 6.67 18.71L6.29 20.13C6.13 20.73 6.72 21.25 7.29 21.02L9.36 20.17C9.79 20 10.27 19.98 10.72 20.08C11.14 20.17 11.57 20.22 12 20.22C16.97 20.22 21 16.64 21 12.22C21 7.8 16.97 3 12 3Z" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                    </label>
                    {themeColor !== DEFAULT_THEME_COLOR && (
                      <button
                        type="button"
                        className="theme-reset-btn"
                        onClick={() => handleThemeColorChange?.(DEFAULT_THEME_COLOR)}
                      >
                        默认
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title">自动检查更新</span>
                  <span className="setting-description">自动检查新版本并后台下载安装包</span>
                </div>
                <div className="setting-control">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={autoUpdate}
                      onChange={e => handleAutoUpdateChange?.(e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title">检查更新</span>
                  <span className="setting-description">检查是否有新版本可用</span>
                </div>
                <div className="setting-control">
                  <button 
                    className="check-update-button"
                    onClick={handleCheckUpdate}
                    disabled={isCheckingUpdate}
                  >
                    {isCheckingUpdate ? '检查中...' : '检查更新'}
                  </button>
                </div>
              </div>
              
              <div className="setting-item">
                <div className="setting-label">
                  <span className="setting-title">清除缓存</span>
                  <span className="setting-description">清除所有缓存的壁纸图片</span>
                </div>
                <div className="setting-control">
                  <button 
                    className="clear-cache-button"
                    onClick={handleClearCache}
                    disabled={isClearingCache}
                  >
                    {isClearingCache ? '清除中...' : '清除缓存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showUpdatePrompt && updateState?.status === 'downloaded' && (
        <div className="update-prompt-overlay" onClick={() => setShowUpdatePrompt(false)}>
          <div
            className="update-prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-prompt-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="update-prompt-header">
              <h3 id="update-prompt-title">发现新版本 {updateState.latestVersion}</h3>
              <button
                type="button"
                className="update-prompt-close"
                onClick={() => setShowUpdatePrompt(false)}
                aria-label="关闭更新提示"
              >
                ×
              </button>
            </div>
            <div className="update-prompt-body">
              <p>
                新版本安装包已自动下载完成（{updateState.currentVersion} → {updateState.latestVersion}）。
              </p>
              <p className="update-prompt-hint">
                点击“立即安装”将启动安装程序并自动退出当前应用。
              </p>
            </div>
            <div className="update-prompt-actions">
              <button
                type="button"
                className="update-prompt-btn secondary"
                onClick={() => setShowUpdatePrompt(false)}
                disabled={isInstallingUpdate}
              >
                稍后安装
              </button>
              <button
                type="button"
                className="update-prompt-btn primary"
                onClick={handleInstallUpdate}
                disabled={isInstallingUpdate}
              >
                {isInstallingUpdate ? '正在启动...' : '立即安装'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showEditor && currentWallpaper && (
        <WallpaperEditorModal
          wallpaper={currentWallpaper}
          isPreviewActive={previewActive}
          onClose={() => setShowEditor(false)}
          onPreviewEdited={handlePreviewEdited}
          onApplyWallpaper={handleApplyEditedWallpaper}
          onSaveLocal={handleSaveEditedWallpaper}
        />
      )}
      {previewActive && currentWallpaper && (
        <WallpaperPreviewOverlay
          wallpaper={editedPreviewUrl ? { ...currentWallpaper, imageUrl: editedPreviewUrl } : currentWallpaper}
          hasMultiple={!editedPreviewUrl && displayWallpapers.length > 1}
          onPrevious={() => setCurrentIndex(prev => prev === 0 ? displayWallpapers.length - 1 : prev - 1)}
          onNext={() => setCurrentIndex(prev => (prev + 1) % displayWallpapers.length)}
          onExit={closePreview}
        />
      )}
    </div>
    {toastView}
    </>
  );
};

export default WallpaperViewer;
