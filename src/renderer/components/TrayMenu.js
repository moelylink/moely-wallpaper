import React, { useEffect, useState } from 'react';
import './TrayMenu.css';

const api = window.wallpaperAPI;

const TrayMenu = () => {
  const [state, setState] = useState({
    currentWallpaper: null,
    hasMultiple: false,
    isSwitching: false
  });

  useEffect(() => {
    let active = true;
    api.getTrayState?.().then(nextState => {
      if (active && nextState) setState(nextState);
    }).catch(console.error);
    const unsubscribe = api.onTrayStateUpdated?.(nextState => {
      if (active && nextState) setState(nextState);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const current = state.currentWallpaper;
  const switchDisabled = !state.hasMultiple || state.isSwitching;

  const handleSwitch = delta => {
    if (switchDisabled) return;
    api.traySwitchWallpaper?.(delta).catch(console.error);
  };

  return (
    <div className="tray-menu-shell">
      <div className="tray-menu-panel" role="menu" aria-label="萌哩壁纸托盘菜单">
        {current?.thumbnailUrl && (
          <div className="tray-menu-thumb-wrap">
            <img className="tray-menu-thumb" src={current.thumbnailUrl} alt="" />
          </div>
        )}
        <div className="tray-menu-header">
          <div className="tray-menu-caption">当前桌面壁纸</div>
          {current ? (
            <div className="tray-menu-info" title={`${current.id}${current.artist ? ` · ${current.artist}` : ''}`}>
              <span className="tray-menu-id">#{current.id}</span>
              {current.artist && <span className="tray-menu-artist">{current.artist}</span>}
            </div>
          ) : (
            <div className="tray-menu-empty">暂未设置壁纸</div>
          )}
        </div>

        <div className="tray-menu-switch-row">
          <button
            type="button"
            role="menuitem"
            className="tray-menu-switch-btn"
            disabled={switchDisabled}
            onClick={() => handleSwitch(-1)}
          >
            <svg className="tray-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6L9 12L15 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>上一张</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tray-menu-switch-btn"
            disabled={switchDisabled}
            onClick={() => handleSwitch(1)}
          >
            <span>下一张</span>
            <svg className="tray-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="tray-menu-divider" />

        <div className="tray-menu-actions">
          <button
            type="button"
            role="menuitem"
            className="tray-menu-item"
            onClick={() => api.trayShowMainWindow?.()}
          >
            <svg className="tray-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
              <path d="M3.5 9H20.5" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            <span>显示主窗口</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tray-menu-item tray-menu-item--danger"
            onClick={() => api.trayQuitApp?.()}
          >
            <svg className="tray-menu-item-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3.5V11.5M16.8 7.2A6.8 6.8 0 1 1 7.2 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span>退出程序</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrayMenu;
