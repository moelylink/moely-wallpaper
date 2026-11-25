import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const WallpaperImage = ({ wallpaper, error, onLoad, onError, onRetry }) => {
  const identity = JSON.stringify([wallpaper.id, wallpaper.imageUrl]);
  const [result, setResult] = useState(null);
  const identityRef = useRef(identity);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    identityRef.current = identity;
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, [identity]);

  useEffect(() => {
    if (!error) {
      setResult(previous => previous?.identity === identity && previous.status === 'error' ? null : previous);
    }
  }, [error, identity]);

  const isCurrent = () => mountedRef.current && identityRef.current === identity;
  const failed = error || (result?.identity === identity && result.status === 'error');
  const ready = !failed && result?.identity === identity && result.status === 'loaded';

  const handleError = () => {
    if (!isCurrent()) return;
    setResult({ identity, status: 'error' });
    onError(wallpaper);
  };

  const handleLoad = async event => {
    const image = event.currentTarget;
    try {
      if (image.decode) await image.decode();
      if (!isCurrent()) return;
      setResult({ identity, status: 'loaded' });
      onLoad(wallpaper);
    } catch {
      handleError();
    }
  };

  return (
    <div className="wallpaper-image-frame" aria-busy={!ready && !failed}>
      {!failed && (
        <img
          key={identity}
          src={wallpaper.imageUrl}
          alt={`壁纸 by ${wallpaper.artist}`}
          className="carousel-image"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          aria-hidden={!ready}
          style={{ visibility: ready ? 'visible' : 'hidden' }}
        />
      )}
      {failed ? (
        <div className="wallpaper-image-placeholder image-error-placeholder" role="alert">
          <div className="error-icon" aria-hidden="true">🖼️</div>
          <div className="error-text">加载失败</div>
          <button
            type="button"
            className="retry-button-small"
            title="重试加载"
            onClick={event => {
              event.stopPropagation();
              setResult(null);
              onRetry(wallpaper);
            }}
          >
            重试
          </button>
        </div>
      ) : !ready && (
        <div className="wallpaper-image-placeholder" role="status" aria-live="polite">
          <div className="wallpaper-image-spinner" aria-hidden="true" />
          <div>加载中...</div>
        </div>
      )}
    </div>
  );
};

export default WallpaperImage;
