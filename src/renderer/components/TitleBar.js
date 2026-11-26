import React, { useEffect, useState } from 'react';
import './TitleBar.css';
import appLogo from '../assets/logo.png';

const api = window.wallpaperAPI;

const TitleBar = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMacOS = api?.platform === 'darwin';

  useEffect(() => {
    let active = true;
    api.isMaximized?.().then(maximized => {
      if (active) setIsMaximized(Boolean(maximized));
    }).catch(() => {});
    const unsubscribe = api.onMaximizedChange?.(maximized => {
      if (active) setIsMaximized(Boolean(maximized));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const handleMinimize = () => {
    api.minimize();
  };

  const handleMaximize = () => {
    api.maximize();
  };

  const handleClose = () => {
    api.close();
  };

  return (
    <div className={`title-bar${isMacOS ? ' is-macos' : ''}`}>
      <div className="title-bar-drag">
        <div className="title-bar-title">
          <img className="title-bar-icon" src={appLogo} alt="" aria-hidden="true" />
          <span>萌哩壁纸</span>
        </div>
      </div>
      {!isMacOS && (
        <div className="title-bar-controls">
          <button className="title-bar-button minimize" title="最小化" aria-label="最小化" onClick={handleMinimize}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className="title-bar-button maximize"
            title={isMaximized ? '向下还原' : '最大化'}
            aria-label={isMaximized ? '向下还原' : '最大化'}
            onClick={handleMaximize}
          >
            {isMaximized ? (
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5.5" y="8.5" width="10" height="10" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8.5 8.5V5.5H18.5V15.5H15.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="6" y="6" width="12" height="12" stroke="currentColor" strokeWidth="2"/>
              </svg>
            )}
          </button>
          <button className="title-bar-button close" title="关闭" aria-label="关闭" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default TitleBar;
