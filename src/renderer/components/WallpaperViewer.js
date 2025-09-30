import React, { useState, useEffect, useCallback, useRef } from 'react';
import './WallpaperViewer.css';

const { ipcRenderer } = window.require('electron');

const WallpaperViewer = ({ wallpapers, showSettings, setShowSettings, autoStart, handleAutoStartChange }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayWallpapers, setDisplayWallpapers] = useState([]);
  const [imageCache, setImageCache] = useState({});
  const [loadingImages, setLoadingImages] = useState({});
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [animationClass, setAnimationClass] = useState('');
  const [isNewImage, setIsNewImage] = useState(false);
  const [slideDirection, setSlideDirection] = useState('');
  const [animatingItems, setAnimatingItems] = useState({});
  const [isSettingWallpaper, setIsSettingWallpaper] = useState(false);
  const [wallpaperStatus, setWallpaperStatus] = useState('');
  const [autoSetWallpaper, setAutoSetWallpaper] = useState(false);
  const [lastAutoSetIndex, setLastAutoSetIndex] = useState(-1);
  
  // 防抖计时器ref
  const debounceTimerRef = useRef(null);
  
  // 跟踪正在加载的图片ID，防止重复加载
  const loadingSetRef = useRef(new Set());

  // 优化的图片预加载函数 - 支持渐进式加载和网络优化
  const preloadSingleImage = useCallback((wallpaper, retryCount = 0, priority = 'low') => {
    const maxRetries = 3; // 增加重试次数
    
    // 检查图片是否已经在缓存中或正在加载
    if (imageCache[wallpaper.id] || loadingImages[wallpaper.id] || loadingSetRef.current.has(wallpaper.id)) {
      console.log(`Image already cached or loading: ${wallpaper.id}`);
      return Promise.resolve(imageCache[wallpaper.id]);
    }
    
    return new Promise((resolve, reject) => {
      // 添加到加载集合中
      loadingSetRef.current.add(wallpaper.id);
      
      // 设置加载状态
      setLoadingImages(prev => ({
        ...prev,
        [wallpaper.id]: true
      }));
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      
      // 网络优化：根据优先级设置不同的加载策略
      if (priority === 'high') {
        img.loading = 'eager';
        img.fetchPriority = 'high';
      } else {
        img.loading = 'lazy';
        img.fetchPriority = 'low';
      }
      
      // 处理加载错误和重试
      const handleImageError = () => {
        setLoadingImages(prev => ({
          ...prev,
          [wallpaper.id]: false
        }));
        
        if (retryCount < maxRetries) {
          console.log(`Retrying image load for ${wallpaper.id} (${retryCount + 1}/${maxRetries + 1})`);
          loadingSetRef.current.delete(wallpaper.id);
          
          // 递增延迟重试，减少服务器压力
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 8000);
          setTimeout(() => {
            preloadSingleImage(wallpaper, retryCount + 1, priority).then(resolve).catch(reject);
          }, retryDelay);
        } else {
          console.error(`Failed to load image after ${maxRetries + 1} attempts: ${wallpaper.id}`);
          loadingSetRef.current.delete(wallpaper.id);
          setImageCache(prev => ({
            ...prev,
            [wallpaper.id]: 'error'
          }));
          reject(new Error(`Failed to load image: ${wallpaper.id}`));
        }
      };
      
      // 优化的超时处理 - 根据重试次数调整超时时间
      const timeoutDuration = Math.min(15000 + (retryCount * 5000), 30000);
      const timeoutId = setTimeout(() => {
        console.log(`Image load timeout for ${wallpaper.id}, attempt ${retryCount + 1}`);
        img.onload = null;
        img.onerror = null;
        img.src = '';
        handleImageError();
      }, timeoutDuration);
      
      img.onload = () => {
        clearTimeout(timeoutId);
        console.log(`Image loaded successfully: ${wallpaper.id} (attempt ${retryCount + 1})`);
        
        loadingSetRef.current.delete(wallpaper.id);
        
        setImageCache(prev => ({
          ...prev,
          [wallpaper.id]: img.src
        }));
        setLoadingImages(prev => ({
          ...prev,
          [wallpaper.id]: false
        }));
        
        resolve(img.src);
      };
      
      img.onerror = () => {
        clearTimeout(timeoutId);
        console.log(`Image load error for ${wallpaper.id}, attempt ${retryCount + 1}`);
        handleImageError();
      };
      
      // 开始加载图片
      img.src = wallpaper.imageUrl;
    });
  }, [imageCache, loadingImages]);

  // 预加载图片
  const preloadImages = useCallback((wallpaperList) => {
    wallpaperList.forEach((wallpaper, index) => {
      // 只预加载没有在缓存中的图片
      if (!imageCache[wallpaper.id] && !loadingImages[wallpaper.id]) {
        preloadSingleImage(wallpaper).catch((error) => {
          console.warn(`Preload failed for image ${wallpaper.id}:`, error.message);
          // 错误已经在preloadSingleImage中处理，这里只是防止未捕获的Promise拒绝
        });
      }
    });
  }, [imageCache, loadingImages, preloadSingleImage]);

  // 设置壁纸
  const handleSetWallpaper = async (wallpaper, isAuto = false) => {
    // 如果没有传入wallpaper参数，使用当前显示的壁纸
    console.log(displayWallpapers.length)
    if (!wallpaper.id && displayWallpapers.length > 0) {
      wallpaper = displayWallpapers[currentIndex];
    }
    if (!wallpaper) return;
    if (isSettingWallpaper && !isAuto) return; // 防止重复点击（自动模式除外）
    setIsSettingWallpaper(true);
    setWallpaperStatus(isAuto ? '自动设置壁纸...' : '正在设置壁纸...');

    // Debug logging to diagnose URL issues
    console.log('handleSetWallpaper called with wallpaper:', {
      id: wallpaper.id,
      imageUrl: wallpaper.imageUrl,
      artist: wallpaper.artist,
      source: wallpaper.source,
      originalUrl: wallpaper.originalUrl
    });

    try {
      // 只传递可序列化的wallpaper属性，包括originalUrl如果存在
      const wallpaperData = {
        id: wallpaper.id,
        imageUrl: wallpaper.imageUrl,
        originalUrl: wallpaper.originalUrl, // Add originalUrl to the data
        artist: wallpaper.artist,
        source: wallpaper.source
      };
      
      console.log('Sending wallpaper data to main process:', wallpaperData);
      const result = await ipcRenderer.invoke('set-wallpaper', wallpaperData);
      if (result.success) {
        setWallpaperStatus(isAuto ? '自动设置成功！' : '壁纸设置成功！');
        if (isAuto) {
          setLastAutoSetIndex(currentIndex);
        }
        // 自动清除成功状态
        setTimeout(() => {
          setWallpaperStatus('');
        }, isAuto ? 2000 : 3000);
      } else {
        setWallpaperStatus(`设置失败: ${result.error}`);
      }
    } catch (error) {
      console.error('Error setting wallpaper:', error);
      setWallpaperStatus(`错误: ${error.message}`);
    } finally {
      setIsSettingWallpaper(false);
    }
  };

  // 自动设置壁纸功能
  useEffect(() => {
    if (autoSetWallpaper && currentIndex !== lastAutoSetIndex && displayWallpapers.length > 0 && !isSettingWallpaper) {
      // 延迟1秒后自动设置壁纸，确保图片切换动画完成
      const timer = setTimeout(() => {
        const currentWallpaper = displayWallpapers[currentIndex];
        if (currentWallpaper && imageCache[currentWallpaper.id] !== 'error') {
          console.log(`Auto setting wallpaper: ${currentWallpaper.id}`);
          handleSetWallpaper(currentWallpaper, true);
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [currentIndex, autoSetWallpaper, lastAutoSetIndex, displayWallpapers, imageCache, isSettingWallpaper, handleSetWallpaper]);

  // 切换自动设置壁纸模式
  const toggleAutoSetWallpaper = () => {
    setAutoSetWallpaper(!autoSetWallpaper);
    if (!autoSetWallpaper) {
      setWallpaperStatus('已开启自动设置壁纸');
      // 立即设置当前壁纸
      if (displayWallpapers.length > 0) {
        const currentWallpaper = displayWallpapers[currentIndex];
        if (currentWallpaper && imageCache[currentWallpaper.id] !== 'error') {
          handleSetWallpaper(currentWallpaper, true);
        }
      }
    } else {
      setWallpaperStatus('已关闭自动设置壁纸');
      setLastAutoSetIndex(-1);
    }
    setTimeout(() => {
      setWallpaperStatus('');
    }, 2000);
  };

  // 获取用于显示的前8张壁纸
  useEffect(() => {
    if (wallpapers && wallpapers.length > 0) {
      const displayItems = wallpapers.slice(0, 8);
      setDisplayWallpapers(displayItems);
      
      // 预加载所有15张图片
      preloadImages(wallpapers);
    }
  }, [wallpapers, preloadImages]);

  // 重试加载单张图片
  const retryLoadImage = (wallpaper) => {
    // 清除错误状态
    setImageCache(prev => {
      const newCache = { ...prev };
      delete newCache[wallpaper.id];
      return newCache;
    });
    
    // 重新加载图片
    preloadSingleImage(wallpaper, 0, 'high');
  };

  // 优化的横向滚动切换函数 - 缩短滑动路径和时间
  const handlePrevious = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setSlideDirection('right'); // 向右滑动显示上一张
    
    // 切换图片时清除壁纸状态
    setWallpaperStatus('');
    
    const prevIdx = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
    const nextIdx = (currentIndex + 1) % displayWallpapers.length;
    
    // 优化：使用更短的动画路径和时间
    setAnimatingItems({
      [prevIdx]: 'fast-slide-to-center-from-left',     // 左边图片快速移到中间
      [currentIndex]: 'fast-slide-to-right-from-center', // 当前图片快速移到右边
      [nextIdx]: 'fast-slide-to-left-from-right'       // 右边图片快速移到左边
    });
    
    // 缩短延迟时间
    setTimeout(() => {
      setCurrentIndex(prevIdx);
    }, 25);
    
    // 总动画时间28ms
    setTimeout(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 280);
  }, [displayWallpapers.length, isTransitioning, currentIndex]);

  // 优化的横向滚动切换函数 - 缩短滑动路径和时间
  const handleNext = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setSlideDirection('left'); // 向左滑动显示下一张
    
    // 切换图片时清除壁纸状态
    setWallpaperStatus('');
    
    const prevIdx = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
    const nextIdx = (currentIndex + 1) % displayWallpapers.length;
    
    // 优化：使用更短的动画路径和时间
    setAnimatingItems({
      [prevIdx]: 'fast-slide-to-right-from-left',     // 左边图片快速移到右边
      [currentIndex]: 'fast-slide-to-left-from-center', // 当前图片快速移到左边
      [nextIdx]: 'fast-slide-to-center-from-right'    // 右边图片快速移到中间
    });
    
    // 缩短延迟时间
    setTimeout(() => {
      setCurrentIndex(nextIdx);
    }, 25);
    
    // 缩短总动画时间从450ms到280ms
    setTimeout(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 280);
  }, [displayWallpapers.length, isTransitioning, currentIndex]);

  // 优化的直接跳转函数 - 使用快速淡入淡出效果
  const handleIndicatorClick = useCallback((index) => {
    if (isTransitioning || index === currentIndex) return;
    setIsTransitioning(true);
    
    // 切换图片时清除壁纸状态
    setWallpaperStatus('');
    
    // 使用快速淡入淡出效果，避免复杂滑动
    setAnimatingItems({
      [currentIndex]: 'fast-fade-out'
    });
    
    setTimeout(() => {
      setCurrentIndex(index);
      
      // 设置新图片的快速淡入动画
      setAnimatingItems({
        [index]: 'fast-fade-in'
      });
    }, 100);
    
    // 缩短总动画时间到200ms
    setTimeout(() => {
      setIsTransitioning(false);
      setSlideDirection('');
      setAnimatingItems({});
    }, 200);
  }, [currentIndex, isTransitioning]);

  // 键盘事件处理
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handlePrevious, handleNext]);

  // 优化鼠标滚轮事件处理 - 降低延迟，提升响应速度
  useEffect(() => {
    const WHEEL_THRESHOLD = 50; // 降低滚轮阈值，提升响应速度
    let wheelTimeout = null;
    
    const handleWheel = (e) => {
      e.preventDefault();
      
      // 清除之前的超时
      if (wheelTimeout) {
        clearTimeout(wheelTimeout);
      }
      
      // 降低防抖延迟，提升响应速度
      wheelTimeout = setTimeout(() => {
        if (Math.abs(e.deltaY) > WHEEL_THRESHOLD && !isTransitioning) {
          if (e.deltaY > 0) {
            handleNext();
          } else if (e.deltaY < 0) {
            handlePrevious();
          }
        }
      }, 50); // 从无延迟改为50ms小延迟，避免过于敏感
    };

    const viewer = document.querySelector('.wallpaper-viewer');
    if (viewer) {
      viewer.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        if (wheelTimeout) {
          clearTimeout(wheelTimeout);
        }
        viewer.removeEventListener('wheel', handleWheel);
      };
    }
  }, [handlePrevious, handleNext, isTransitioning]);

  if (!displayWallpapers.length) {
    return <div className="no-wallpapers">暂无壁纸数据</div>;
  }

  const currentWallpaper = displayWallpapers[currentIndex];
  const prevIndex = currentIndex === 0 ? displayWallpapers.length - 1 : currentIndex - 1;
  const nextIndex = (currentIndex + 1) % displayWallpapers.length;
  const prevWallpaper = displayWallpapers[prevIndex];
  const nextWallpaper = displayWallpapers[nextIndex];

  return (
    <div className="wallpaper-viewer">
      <div className={`wallpaper-container ${isTransitioning ? 'transitioning' : ''}`}>
        {/* 3D轮播容器 */}
        <div className="carousel-3d-container">
          {/* 上一张图片 (右半部分可见) */}
          <div className={`carousel-item carousel-prev ${animatingItems[prevIndex] || ''}`} onClick={handlePrevious}>
            {imageCache[prevWallpaper.id] === 'error' ? (
              <div className="image-error-placeholder">
                <div className="error-square">
                  <div className="error-icon">🖼️</div>
                  <div className="error-text">加载失败</div>
                  <button 
                    className="retry-button-small" 
                    onClick={(e) => {
                      e.stopPropagation();
                      retryLoadImage(prevWallpaper);
                    }}
                    title="重试加载"
                  >
                    🔄
                  </button>
                </div>
              </div>
            ) : (
              <img 
                src={prevWallpaper.imageUrl} 
                alt={`壁纸 by ${prevWallpaper.artist}`}
                className="carousel-image"
                onLoad={(e) => {
                  setLoadingImages(prev => ({
                    ...prev,
                    [prevWallpaper.id]: false
                  }));
                }}
                onError={(e) => {
                  console.error(`Failed to load image: ${prevWallpaper.id}`);
                  setImageCache(prev => ({
                    ...prev,
                    [prevWallpaper.id]: 'error'
                  }));
                  setLoadingImages(prev => ({
                    ...prev,
                    [prevWallpaper.id]: false
                  }));
                }}
style={{ 
                  objectFit: 'cover',
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              />
            )}
            {loadingImages[prevWallpaper.id] && (
              <div className="loading-indicator">
                <div className="spinner"></div>
                <div>加载中...</div>
              </div>
            )}
          </div>

          {/* 当前图片 (完全可见) */}
          <div className={`carousel-item carousel-current ${isNewImage ? 'new-image' : ''} ${animatingItems[currentIndex] || ''}`}>
            {imageCache[currentWallpaper.id] === 'error' ? (
              <div className="image-error-placeholder">
                <div className="error-square">
                  <div className="error-icon">🖼️</div>
                  <div className="error-text">加载失败</div>
                  <button 
                    className="retry-button-small" 
                    onClick={(e) => {
                      e.stopPropagation();
                      retryLoadImage(currentWallpaper);
                    }}
                    title="重试加载"
                  >
                    🔄
                  </button>
                </div>
              </div>
            ) : (
              <img 
                src={currentWallpaper.imageUrl} 
                alt={`壁纸 by ${currentWallpaper.artist}`}
                className="carousel-image"
                onLoad={(e) => {
                  setLoadingImages(prev => ({
                    ...prev,
                    [currentWallpaper.id]: false
                  }));
                }}
                onError={(e) => {
                  console.error(`Failed to load image: ${currentWallpaper.id}`);
                  setImageCache(prev => ({
                    ...prev,
                    [currentWallpaper.id]: 'error'
                  }));
                  setLoadingImages(prev => ({
                    ...prev,
                    [currentWallpaper.id]: false
                  }));
                }}
                style={{ 
                  objectFit: 'cover',
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              />
            )}
            {loadingImages[currentWallpaper.id] && (
              <div className="loading-indicator">
                加载中...
              </div>
            )}
          </div>

          {/* 下一张图片 (左半部分可见) */}
          <div className={`carousel-item carousel-next ${animatingItems[nextIndex] || ''}`} onClick={handleNext}>
            {imageCache[nextWallpaper.id] === 'error' ? (
              <div className="image-error-placeholder">
                <div className="error-square">
                  <div className="error-icon">🖼️</div>
                  <div className="error-text">加载失败</div>
                  <button 
                    className="retry-button-small" 
                    onClick={(e) => {
                      e.stopPropagation();
                      retryLoadImage(nextWallpaper);
                    }}
                    title="重试加载"
                  >
                    🔄
                  </button>
                </div>
              </div>
            ) : (
              <img 
                src={nextWallpaper.imageUrl} 
                alt={`壁纸 by ${nextWallpaper.artist}`}
                className="carousel-image"
                onLoad={(e) => {
                  setLoadingImages(prev => ({
                    ...prev,
                    [nextWallpaper.id]: false
                  }));
                }}
                onError={(e) => {
                  console.error(`Failed to load image: ${nextWallpaper.id}`);
                  setImageCache(prev => ({
                    ...prev,
                    [nextWallpaper.id]: 'error'
                  }));
                  setLoadingImages(prev => ({
                    ...prev,
                    [nextWallpaper.id]: false
                  }));
                }}
                style={{ 
                  objectFit: 'cover',
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%'
                }}
              />
            )}
            {loadingImages[nextWallpaper.id] && (
              <div className="loading-indicator">
                加载中...
              </div>
            )}
          </div>
        </div>
      </div>

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
        {/* 状态显示 */}
        {wallpaperStatus && (
          <div className="info-item status-item">
            <span className="status-text">{wallpaperStatus}</span>
          </div>
        )}
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
          onClick={handleSetWallpaper}
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
      
      {/* 在萌哩打开按钮 - 右下角 */}
      <div className="moely-link-container">
        <button 
          className="moely-link-button"
          onClick={() => ipcRenderer.invoke('open-external', `https://www.moely.link/img/${currentWallpaper.id}/`)}
          title="在萌哩打开"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '6px'}}>
            <path d="M10 6V8H5V19H16V14H18V19C18 20.1 17.1 21 16 21H5C3.9 21 3 20.1 3 19V8C3 6.9 3.9 6 5 6H10Z" fill="currentColor"/>
            <path d="M21 3H15V5H18.59L9.76 13.83L11.17 15.24L20 6.41V10H22V3C22 2.45 21.55 2 21 2V3Z" fill="currentColor"/>
          </svg>
          在萌哩打开
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="settings-panel-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-panel-header">
              <h3>设置</h3>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WallpaperViewer;
