import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import thisPcIcon from '../assets/desktop-mock/this-pc.png';
import recycleBinIcon from '../assets/desktop-mock/recycle-bin.png';
import networkIcon from '../assets/desktop-mock/network.png';
import folderIcon from '../assets/desktop-mock/folder.png';
import explorerIcon from '../assets/desktop-mock/explorer.png';
import moelyIcon from '../assets/desktop-mock/moely.png';
import controlPanelIcon from '../assets/desktop-mock/control-panel.png';
import chromeIcon from '../assets/desktop-mock/chrome.png';
import wechatIcon from '../assets/desktop-mock/wechat.png';
import './WallpaperPreviewOverlay.css';

const DESKTOP_ICONS = [
  { id: 'pc', label: '此电脑', src: thisPcIcon },
  { id: 'recycle-bin', label: '回收站', src: recycleBinIcon },
  { id: 'control-panel', label: '控制面板', src: controlPanelIcon },
  { id: 'network', label: '网络', src: networkIcon },
  { id: 'folder', label: '壁纸收藏', src: folderIcon },
  { id: 'chrome', label: 'Google Chrome', src: chromeIcon },
  { id: 'wechat', label: '微信', src: wechatIcon },
  { id: 'moely', label: '萌哩壁纸', src: moelyIcon }
];

function formatClock(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return { time: `${hours}:${minutes}`, date: `${year}/${month}/${day}` };
}

const WallpaperPreviewOverlay = ({
  wallpaper, wallpaperScale = 'fill', hasMultiple = false, onPrevious, onNext, onExit
}) => {
  const [fitMode, setFitMode] = useState(wallpaperScale === 'fit' ? 'contain' : 'cover');
  const [showDesktopMock, setShowDesktopMock] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const hideTimerRef = useRef(null);

  useEffect(() => {
    setFitMode(wallpaperScale === 'fit' ? 'contain' : 'cover');
  }, [wallpaperScale]);

  useEffect(() => {
    const scheduleHide = () => {
      clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
    };
    scheduleHide();
    window.addEventListener('mousemove', scheduleHide);
    return () => {
      clearTimeout(hideTimerRef.current);
      window.removeEventListener('mousemove', scheduleHide);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(formatClock(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onExit();
      } else if (event.key === 'ArrowLeft' && hasMultiple) {
        event.preventDefault();
        event.stopPropagation();
        onPrevious?.();
      } else if (event.key === 'ArrowRight' && hasMultiple) {
        event.preventDefault();
        event.stopPropagation();
        onNext?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hasMultiple, onPrevious, onNext, onExit]);

  if (!wallpaper) return null;

  return createPortal(
    <div className="wallpaper-preview-overlay" role="dialog" aria-modal="true" aria-label="壁纸全屏预览">
      <img
        className={`preview-wallpaper-image fit-${fitMode}`}
        src={wallpaper.imageUrl}
        alt={`壁纸 ${wallpaper.id} 全屏预览`}
      />

      {showDesktopMock && (
        <div className="preview-desktop-mock" aria-hidden="true">
          <div className="mock-desktop-icons">
            {DESKTOP_ICONS.map(item => (
              <div key={item.id} className="mock-desktop-icon">
                <img className="mock-icon-img" src={item.src} alt="" />
                <span className="mock-icon-label">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="mock-taskbar">
            <div className="mock-taskbar-center">
              <span className="mock-taskbar-item">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="#4cc2ff" />
                  <rect x="12.5" y="2.5" width="9" height="9" rx="1" fill="#4cc2ff" />
                  <rect x="2.5" y="12.5" width="9" height="9" rx="1" fill="#0078d4" />
                  <rect x="12.5" y="12.5" width="9" height="9" rx="1" fill="#0078d4" />
                </svg>
              </span>
              <span className="mock-taskbar-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>搜索</span>
              </span>
              <span className="mock-taskbar-item">
                <img src={explorerIcon} alt="" />
              </span>
              <span className="mock-taskbar-item">
                <img src={chromeIcon} alt="" />
              </span>
              <span className="mock-taskbar-item">
                <img src={wechatIcon} alt="" />
              </span>
              <span className="mock-taskbar-item active">
                <img src={moelyIcon} alt="" />
              </span>
            </div>

            <div className="mock-taskbar-right">
              <span className="mock-tray-ime">中</span>
              <span className="mock-tray-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M2.5 8.5C7.8 3.8 16.2 3.8 21.5 8.5M5.8 12.2C9.3 9.1 14.7 9.1 18.2 12.2M9.2 15.8C10.8 14.4 13.2 14.4 14.8 15.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="12" cy="19" r="1.4" fill="currentColor" />
                </svg>
              </span>
              <span className="mock-tray-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9.5H8L13 5V19L8 14.5H4V9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M16.5 8.5C17.8 9.8 17.8 14.2 16.5 15.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              <div className="mock-taskbar-tray">
                <span>{clock.time}</span>
                <span>{clock.date}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`preview-toolbar${controlsVisible ? ' visible' : ''}`}>
        <div className="preview-meta">
          <span className="preview-badge">预览</span>
          <span className="preview-id">ID: {wallpaper.id}</span>
          {wallpaper.artist && <span className="preview-artist">画师: {wallpaper.artist}</span>}
        </div>
        <div className="preview-actions">
          <button
            type="button"
            className={`preview-action-btn${fitMode === 'cover' ? ' active' : ''}`}
            onClick={() => setFitMode('cover')}
          >
            填充
          </button>
          <button
            type="button"
            className={`preview-action-btn${fitMode === 'contain' ? ' active' : ''}`}
            onClick={() => setFitMode('contain')}
          >
            适应
          </button>
          <button
            type="button"
            className={`preview-action-btn${showDesktopMock ? ' active' : ''}`}
            onClick={() => setShowDesktopMock(prev => !prev)}
          >
            桌面模拟
          </button>
          {hasMultiple && (
            <>
              <button
                type="button"
                className="preview-action-btn icon-only"
                aria-label="上一张预览"
                onClick={onPrevious}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="preview-action-btn icon-only"
                aria-label="下一张预览"
                onClick={onNext}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <button
            type="button"
            className="preview-action-btn exit-btn"
            onClick={onExit}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            退出（ESC）
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default WallpaperPreviewOverlay;
