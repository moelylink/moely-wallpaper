import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export default function useWallpaperImages(wallpapers) {
  const [states, setStates] = useState({});
  const statesRef = useRef({});
  const tasksRef = useRef(new Map());
  const mountedRef = useRef(false);
  const sourcesRef = useRef(new Map());
  useLayoutEffect(() => {
    sourcesRef.current = new Map(wallpapers.map(wallpaper => [String(wallpaper.id), wallpaper.imageUrl]));
  }, [wallpapers]);

  const update = useCallback((wallpaper, status) => {
    if (!mountedRef.current || sourcesRef.current.get(String(wallpaper.id)) !== wallpaper.imageUrl) return;
    statesRef.current = {
      ...statesRef.current, [wallpaper.id]: { url: wallpaper.imageUrl, status }
    };
    setStates(statesRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const tasks = tasksRef.current;
    return () => {
      mountedRef.current = false;
      for (const task of tasks.values()) task.cancel();
      tasks.clear();
      statesRef.current = {};
    };
  }, []);

  const loadImage = useCallback((wallpaper, force = false) => {
    if (!wallpaper || !mountedRef.current) return;
    const previous = statesRef.current[wallpaper.id];
    const currentTask = tasksRef.current.get(wallpaper.id);
    if (!force && previous?.url === wallpaper.imageUrl) return;
    if (currentTask) currentTask.cancel();
    let cancelled = false;
    let img;
    let timeout;
    let retryTimer;
    const task = {
      url: wallpaper.imageUrl,
      cancel() {
        cancelled = true;
        clearTimeout(timeout);
        clearTimeout(retryTimer);
        if (img) {
          img.onload = null;
          img.onerror = null;
          img.src = '';
        }
      }
    };
    tasksRef.current.set(wallpaper.id, task);
    update(wallpaper, 'loading');
    const attempt = count => {
      if (cancelled || !mountedRef.current) return;
      img = new Image();
      img.decoding = 'async';
      const detach = () => {
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
      };
      const failed = () => {
        detach();
        img.src = '';
        if (cancelled) return;
        if (count < 2) {
          retryTimer = setTimeout(() => attempt(count + 1), 1000 * (2 ** count));
        } else {
          tasksRef.current.delete(wallpaper.id);
          update(wallpaper, 'error');
        }
      };
      img.onload = () => {
        detach();
        if (cancelled) return;
        tasksRef.current.delete(wallpaper.id);
        update(wallpaper, 'loaded');
      };
      img.onerror = failed;
      timeout = setTimeout(failed, 15000);
      img.src = wallpaper.imageUrl;
    };
    attempt(0);
  }, [update]);

  useEffect(() => {
    const urls = new Map(wallpapers.map(wallpaper => [String(wallpaper.id), wallpaper.imageUrl]));
    for (const [id, task] of tasksRef.current) {
      if (urls.get(String(id)) !== task.url) {
        task.cancel();
        tasksRef.current.delete(id);
      }
    }
    const retained = Object.fromEntries(Object.entries(statesRef.current)
      .filter(([id, state]) => urls.get(id) === state.url));
    if (Object.keys(retained).length !== Object.keys(statesRef.current).length) {
      statesRef.current = retained;
      setStates(retained);
    }
  }, [wallpapers]);

  const preloadImages = useCallback(list => list.forEach(wallpaper => loadImage(wallpaper)), [loadImage]);
  const retryLoadImage = useCallback(wallpaper => loadImage(wallpaper, true), [loadImage]);
  const markImageLoaded = useCallback(wallpaper => update(wallpaper, 'loaded'), [update]);
  const markImageError = useCallback(wallpaper => update(wallpaper, 'error'), [update]);
  const { imageCache, loadingImages } = useMemo(() => {
    const imageCache = {};
    const loadingImages = {};
    for (const wallpaper of wallpapers) {
      const state = states[wallpaper.id];
      const status = state?.url === wallpaper.imageUrl ? state.status : null;
      if (status === 'error') imageCache[wallpaper.id] = 'error';
      if (status === 'loaded') imageCache[wallpaper.id] = wallpaper.imageUrl;
      loadingImages[wallpaper.id] = !status || status === 'loading';
    }
    return { imageCache, loadingImages };
  }, [wallpapers, states]);

  return { imageCache, loadingImages, preloadImages, retryLoadImage, markImageLoaded, markImageError };
}
