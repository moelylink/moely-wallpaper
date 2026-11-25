import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import TrayMenu from './renderer/components/TrayMenu.js';
import './renderer/styles/global.css';

const isTrayView = window.location.hash === '#tray';
if (isTrayView) {
  document.documentElement.classList.add('tray-menu-root');
}

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    {isTrayView ? <TrayMenu /> : <App />}
  </React.StrictMode>
);
