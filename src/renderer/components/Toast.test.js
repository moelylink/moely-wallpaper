import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Toast from './Toast.js';

let root;
let container;
let onDismiss;
const message = { id: 1, type: 'success', title: '壁纸设置成功', description: '壁纸 123 · artist', duration: 4000 };
const renderToast = toast => act(() => root.render(<Toast key={toast?.id ?? 'empty'} toast={toast} onDismiss={onDismiss} />));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onDismiss = jest.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('toast renders outside the app card with accessible status text', () => {
  renderToast(message);
  const toast = document.querySelector('.app-toast');
  expect(container.contains(toast)).toBe(false);
  expect(toast.getAttribute('role')).toBe('status');
  expect(toast.textContent).toContain('壁纸 123');
  expect(toast.querySelector('[aria-label="关闭通知"]')).not.toBeNull();
});

test('errors use alert semantics and pending operations do not time out', () => {
  renderToast({ ...message, type: 'error' });
  expect(document.querySelector('.app-toast').getAttribute('role')).toBe('alert');
  renderToast({ ...message, id: 2, type: 'loading', duration: 0 });
  act(() => jest.advanceTimersByTime(60000));
  expect(onDismiss).not.toHaveBeenCalled();
  expect(document.querySelector('.app-toast__spinner')).not.toBeNull();
});

test('automatic and manual dismissal refer to the displayed toast ID', () => {
  renderToast(message);
  act(() => jest.advanceTimersByTime(4000));
  expect(onDismiss).toHaveBeenCalledWith(1);
  renderToast({ ...message, id: 2 });
  act(() => document.querySelector('.app-toast__close').click());
  expect(onDismiss).toHaveBeenLastCalledWith(2);
});

test('a previous notification timer cannot dismiss a replacement notification', () => {
  renderToast(message);
  act(() => jest.advanceTimersByTime(3000));
  renderToast({ ...message, id: 2 });
  act(() => jest.advanceTimersByTime(1000));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(3000));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledWith(2);
});

test('hover pauses dismissal so the message can be read', () => {
  renderToast(message);
  const toast = document.querySelector('.app-toast');
  act(() => toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  act(() => jest.advanceTimersByTime(10000));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  act(() => jest.advanceTimersByTime(4000));
  expect(onDismiss).toHaveBeenCalledWith(1);
});

test('keyboard focus pauses dismissal and unmount removes pending timers', () => {
  renderToast(message);
  act(() => document.querySelector('.app-toast__close').focus());
  act(() => jest.advanceTimersByTime(10000));
  expect(onDismiss).not.toHaveBeenCalled();
  act(() => document.querySelector('.app-toast__close').blur());
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  act(() => root.unmount());
  expect(jest.getTimerCount()).toBe(0);
  root = createRoot(container);
});

test('toasts array renders stacked notifications and dismisses by ID', () => {
  act(() => root.render(
    <Toast
      toasts={[message, { ...message, id: 2, title: '第二条通知', type: 'info' }]}
      onDismiss={onDismiss}
    />
  ));
  const items = [...document.querySelectorAll('.toast-region .app-toast')];
  expect(items).toHaveLength(2);
  expect(items[1].textContent).toContain('第二条通知');
  act(() => items[1].querySelector('.app-toast__close').click());
  expect(onDismiss).toHaveBeenCalledWith(2);
});
