import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AnnouncementModal.css';

const { ipcRenderer } = window.require('electron');

/**
 * @param {object} props
 * @param {{ markdown: string, contentHash: string }} props.notice
 * @param {() => void} props.onDismiss
 */
const AnnouncementModal = ({ notice, onDismiss }) => {
  if (!notice || !notice.markdown) {
    return null;
  }

  const openExternal = (e, url) => {
    e.preventDefault();
    if (url) {
      ipcRenderer.invoke('open-external', url).catch((err) => {
        console.error('open-external failed:', err);
      });
    }
  };

  const mdComponents = {
    a: ({ href, children, ...rest }) => (
      <a
        href={href}
        {...rest}
        onClick={(e) => openExternal(e, href)}
        className="announcement-md-link"
      >
        {children}
      </a>
    ),
    img: ({ src, alt, ...rest }) => (
      <img
        src={src}
        alt={alt || ''}
        className="announcement-md-img"
        {...rest}
      />
    )
  };

  return (
    <div
      className="announcement-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
      onClick={onDismiss}
    >
      <div
        className="announcement-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="announcement-header">
          <h2 id="announcement-title" className="announcement-title">
            公告
          </h2>
          <button
            type="button"
            className="announcement-close"
            onClick={onDismiss}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </div>
        <div className="announcement-body announcement-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {notice.markdown}
          </ReactMarkdown>
        </div>
        <div className="announcement-actions">
          <button
            type="button"
            className="announcement-btn announcement-btn-primary"
            onClick={onDismiss}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementModal;
