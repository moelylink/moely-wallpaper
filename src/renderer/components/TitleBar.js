import React from 'react';
import './TitleBar.css';

const { ipcRenderer } = window.require('electron');

const TitleBar = () => {
  const handleMinimize = () => {
    ipcRenderer.send('window-minimize');
  };

  const handleMaximize = () => {
    ipcRenderer.send('window-maximize');
  };

  const handleClose = () => {
    ipcRenderer.send('window-close');
  };

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <div className="title-bar-title">
          <svg className="title-bar-icon" viewBox="0 0 24 24" fill="none">
            <path d="M4 16L10 10L4 4M14 4L20 10L14 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
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
