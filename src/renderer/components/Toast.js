import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './Toast.css';

const ToastCard = ({ toast, onDismiss }) => {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!toast || toast.duration === 0 || hovered || focused) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, hovered, focused]);

  const type = toast.type || 'info';
  return (
    <div
      className={`app-toast app-toast--${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="app-toast__icon" aria-hidden="true">
        {type === 'loading' ? <span className="app-toast__spinner" /> : (
          <svg viewBox="0 0 24 24" fill="none" focusable="false">
            <circle cx="12" cy="12" r="9" />
            {type === 'success' ? <path d="m8 12 3 3 5-6" /> : type === 'error' ? (
              <path d="m9 9 6 6m0-6-6 6" />
            ) : <path d="M12 11v6m0-10v.1" />}
          </svg>
        )}
      </span>
      <div className="app-toast__content">
        <div className="app-toast__title">{toast.title}</div>
        {toast.description && <div className="app-toast__description">{toast.description}</div>}
      </div>
      <button
        type="button"
        className="app-toast__close"
        aria-label="关闭通知"
        onClick={() => onDismiss(toast.id)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="m7 7 10 10m0-10L7 17" />
        </svg>
      </button>
    </div>
  );
};

const Toast = ({ toast, toasts, onDismiss }) => {
  const list = Array.isArray(toasts) ? toasts : (toast ? [toast] : []);
  if (!list.length) return null;
  return createPortal(
    <div className="toast-region">
      {list.map(item => (
        <ToastCard key={item.id} toast={item} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
};

export default Toast;
