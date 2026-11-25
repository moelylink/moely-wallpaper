import React from 'react';
import './TitleBar.css';
import appLogo from '../assets/logo.png';

const api = window.wallpaperAPI;

const TitleBar = () => {
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
    <div className="title-bar">
      <div className="title-bar-drag">
        <div className="title-bar-title">
          <img className="title-bar-icon" src={appLogo} alt="" aria-hidden="true" />
          <span>萌哩壁纸</span>
        </div>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-button minimize" onClick={handleMinimize}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <button className="title-bar-button maximize" onClick={handleMaximize}>
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" stroke="currentColor" strokeWidth="2"/>
          </svg>
        </button>
        <button className="title-bar-button close" onClick={handleClose}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
