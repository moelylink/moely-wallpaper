import React, { useState, useEffect, useRef, useCallback } from 'react';
import './LazyImage.css';

const LazyImage = ({ 
  src, 
  alt, 
  className = '', 
  style = {},
  onLoad,
  onError,
  priority = 'low',
  placeholderColor = '#1a1a1a',
  ...props 
}) => {
  const [loadingState, setLoadingState] = useState('placeholder'); // placeholder, loading, loaded, error
  const [imageSrc, setImageSrc] = useState('');
  const [blurAmount, setBlurAmount] = useState(20);
  const imageRef = useRef(null);
  const observerRef = useRef(null);
  const retryCountRef = useRef(0);

  // 生成低质量占位图片（使用 Canvas 创建模糊的低分辨率版本）
  const generatePlaceholder = useCallback((originalSrc) => {
    // 简单的颜色占位符，可以根据需要优化
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 75;
    const ctx = canvas.getContext('2d');
    
    // 创建渐变背景作为占位符
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, placeholderColor);
    gradient.addColorStop(0.5, '#2a2a2a');
    gradient.addColorStop(1, placeholderColor);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.3);
  }, [placeholderColor]);

  // 优化的图片加载函数
  const loadImage = useCallback(async (imageUrl, retryCount = 0) => {
    const maxRetries = 3;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      
      // 网络优化设置
      if (priority === 'high') {
        img.loading = 'eager';
        img.fetchPriority = 'high';
      } else {
        img.loading = 'lazy';
        img.fetchPriority = 'low';
      }

      const timeoutDuration = Math.min(15000 + (retryCount * 5000), 30000);
      const timeoutId = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
        
        if (retryCount < maxRetries) {
          console.log(`Retrying image load (${retryCount + 1}/${maxRetries + 1}): ${imageUrl}`);
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 8000);
          setTimeout(() => {
            loadImage(imageUrl, retryCount + 1).then(resolve).catch(reject);
          }, retryDelay);
        } else {
          reject(new Error(`Failed to load image after ${maxRetries + 1} attempts`));
        }
      }, timeoutDuration);

      img.onload = () => {
        clearTimeout(timeoutId);
        resolve(img);
      };

      img.onerror = () => {
        clearTimeout(timeoutId);
        if (retryCount < maxRetries) {
          console.log(`Image load error, retrying (${retryCount + 1}/${maxRetries + 1}): ${imageUrl}`);
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 8000);
          setTimeout(() => {
            loadImage(imageUrl, retryCount + 1).then(resolve).catch(reject);
          }, retryDelay);
        } else {
          reject(new Error(`Failed to load image after ${maxRetries + 1} attempts`));
        }
      };

      img.src = imageUrl;
    });
  }, [priority]);

  // 渐进式模糊减少效果
  const reduceBlur = useCallback(() => {
    const steps = 8;
    const stepDuration = 50;
    let currentStep = 0;

    const animate = () => {
      if (currentStep <= steps) {
        const progress = currentStep / steps;
        const easeOut = 1 - Math.pow(1 - progress, 3); // 缓出动画
        const newBlur = Math.max(0, 20 * (1 - easeOut));
        setBlurAmount(newBlur);
        
        currentStep++;
        if (currentStep <= steps) {
          setTimeout(animate, stepDuration);
        }
      }
    };
    
    animate();
  }, []);

  // Intersection Observer 懒加载
  useEffect(() => {
    if (!imageRef.current || !src) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && loadingState === 'placeholder') {
            setLoadingState('loading');
            
            // 设置占位图
            const placeholder = generatePlaceholder(src);
            setImageSrc(placeholder);
            
            // 开始加载真实图片
            loadImage(src, retryCountRef.current)
              .then((img) => {
                setImageSrc(img.src);
                setLoadingState('loaded');
                
                // 开始模糊到清晰的过渡
                setTimeout(() => {
                  reduceBlur();
                }, 100);
                
                if (onLoad) onLoad();
              })
              .catch((error) => {
                console.error('Failed to load image:', error);
                setLoadingState('error');
                if (onError) onError(error);
              });
            
            // 停止观察
            observer.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin: '50px', // 提前50px开始加载
        threshold: 0.1
      }
    );

    observer.observe(imageRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [src, loadingState, generatePlaceholder, loadImage, reduceBlur, onLoad, onError]);

  // 立即加载高优先级图片
  useEffect(() => {
    if (priority === 'high' && src && loadingState === 'placeholder') {
      setLoadingState('loading');
      
      const placeholder = generatePlaceholder(src);
      setImageSrc(placeholder);
      
      loadImage(src, retryCountRef.current)
        .then((img) => {
          setImageSrc(img.src);
          setLoadingState('loaded');
          setTimeout(() => {
            reduceBlur();
          }, 100);
          if (onLoad) onLoad();
        })
        .catch((error) => {
          console.error('Failed to load high priority image:', error);
          setLoadingState('error');
          if (onError) onError(error);
        });
    }
  }, [src, priority, loadingState, generatePlaceholder, loadImage, reduceBlur, onLoad, onError]);

  const renderContent = () => {
    switch (loadingState) {
      case 'placeholder':
        return (
          <div className="lazy-image-placeholder" style={{
            backgroundColor: placeholderColor,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...style
          }}>
            <div className="placeholder-icon">📷</div>
          </div>
        );

      case 'loading':
        return (
          <>
            {imageSrc && (
              <img
                src={imageSrc}
                alt={alt}
                className={`lazy-image loading ${className}`}
                style={{
                  filter: `blur(${blurAmount}px)`,
                  transition: 'filter 0.3s ease-out',
                  ...style
                }}
                {...props}
              />
            )}
            <div className="lazy-image-loading-overlay">
              <div className="loading-spinner"></div>
              <div className="loading-text">加载中...</div>
            </div>
          </>
        );

      case 'loaded':
        return (
          <img
            src={imageSrc}
            alt={alt}
            className={`lazy-image loaded ${className}`}
            style={{
              filter: `blur(${blurAmount}px)`,
              transition: 'filter 0.3s ease-out',
              ...style
            }}
            {...props}
          />
        );

      case 'error':
        return (
          <div className="lazy-image-error" style={style}>
            <div className="error-icon">⚠️</div>
            <div className="error-text">加载失败</div>
            <button 
              className="retry-button"
              onClick={() => {
                retryCountRef.current = 0;
                setLoadingState('placeholder');
                setBlurAmount(20);
              }}
            >
              重试
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div 
      ref={imageRef}
      className={`lazy-image-container ${loadingState}`}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {renderContent()}
    </div>
  );
};

export default LazyImage;
