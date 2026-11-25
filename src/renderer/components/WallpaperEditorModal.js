import React, { useEffect, useRef, useState, useCallback } from 'react';
import './WallpaperEditorModal.css';

const ASPECT_PRESETS = [
  { id: 'original', label: '原图比例', ratio: null },
  { id: 'free', label: '自由裁剪', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '16:10', label: '16:10', ratio: 16 / 10 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 }
];

const DEFAULT_CROP = { x: 0, y: 0, width: 1, height: 1 };
const MIN_CROP_SIZE = 0.05;

const HANDLE_CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  w: 'ew-resize',
  e: 'ew-resize',
  move: 'move'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatAdjustment(value) {
  return value > 0 ? `+${value}` : String(value);
}

function getBipolarTrackStyle(value, maxAbs = 50) {
  const percent = ((value + maxAbs) / (maxAbs * 2)) * 100;
  const start = Math.min(50, percent);
  const end = Math.max(50, percent);
  return {
    background: `linear-gradient(to right, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.16) ${start}%, var(--primary-color) ${start}%, var(--primary-color) ${end}%, rgba(255,255,255,0.16) ${end}%, rgba(255,255,255,0.16) 100%)`
  };
}

function getRotatedDimensions(width, height, rotation) {
  return rotation % 180 === 0
    ? { width, height }
    : { width: height, height: width };
}

function computeCenteredCrop(rotatedWidth, rotatedHeight, targetRatio) {
  if (!rotatedWidth || !rotatedHeight || !targetRatio) {
    return { ...DEFAULT_CROP };
  }
  const sourceRatio = rotatedWidth / rotatedHeight;
  if (Math.abs(sourceRatio - targetRatio) < 0.001) {
    return { ...DEFAULT_CROP };
  }
  if (sourceRatio > targetRatio) {
    const width = clamp(targetRatio / sourceRatio, MIN_CROP_SIZE, 1);
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = clamp(sourceRatio / targetRatio, MIN_CROP_SIZE, 1);
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

function hitTestCropHandle(nx, ny, crop, viewW, viewH) {
  const tolX = 14 / Math.max(1, viewW);
  const tolY = 14 / Math.max(1, viewH);
  const left = crop.x;
  const right = crop.x + crop.width;
  const top = crop.y;
  const bottom = crop.y + crop.height;

  const nearLeft = Math.abs(nx - left) <= tolX && ny >= top - tolY && ny <= bottom + tolY;
  const nearRight = Math.abs(nx - right) <= tolX && ny >= top - tolY && ny <= bottom + tolY;
  const nearTop = Math.abs(ny - top) <= tolY && nx >= left - tolX && nx <= right + tolX;
  const nearBottom = Math.abs(ny - bottom) <= tolY && nx >= left - tolX && nx <= right + tolX;

  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearLeft && nearBottom) return 'sw';
  if (nearRight && nearBottom) return 'se';
  if (nearTop) return 'n';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  if (nearRight) return 'e';
  if (nx > left && nx < right && ny > top && ny < bottom && (crop.width < 0.999 || crop.height < 0.999)) {
    return 'move';
  }
  return null;
}

function resizeCropByHandle(origin, handle, nx, ny, normRatio) {
  const right0 = origin.x + origin.width;
  const bottom0 = origin.y + origin.height;
  let left = origin.x;
  let right = right0;
  let top = origin.y;
  let bottom = bottom0;

  if (handle.includes('w')) left = clamp(nx, 0, right0 - MIN_CROP_SIZE);
  if (handle.includes('e')) right = clamp(nx, origin.x + MIN_CROP_SIZE, 1);
  if (handle.includes('n')) top = clamp(ny, 0, bottom0 - MIN_CROP_SIZE);
  if (handle.includes('s')) bottom = clamp(ny, origin.y + MIN_CROP_SIZE, 1);

  if (!normRatio) {
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  let width = right - left;
  let height = bottom - top;

  if (handle === 'n' || handle === 's') {
    width = clamp(height * normRatio, MIN_CROP_SIZE, 1);
    height = width / normRatio;
    const centerX = origin.x + origin.width / 2;
    left = clamp(centerX - width / 2, 0, 1 - width);
    right = left + width;
    if (handle === 'n') top = clamp(bottom0 - height, 0, bottom0 - MIN_CROP_SIZE);
    else bottom = clamp(origin.y + height, origin.y + MIN_CROP_SIZE, 1);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  if (handle === 'w' || handle === 'e') {
    height = clamp(width / normRatio, MIN_CROP_SIZE, 1);
    width = height * normRatio;
    const centerY = origin.y + origin.height / 2;
    top = clamp(centerY - height / 2, 0, 1 - height);
    bottom = top + height;
    if (handle === 'w') left = clamp(right0 - width, 0, right0 - MIN_CROP_SIZE);
    else right = clamp(origin.x + width, origin.x + MIN_CROP_SIZE, 1);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  const maxW = handle.includes('w') ? right0 : 1 - origin.x;
  const maxH = handle.includes('n') ? bottom0 : 1 - origin.y;
  if (width / Math.max(height, 0.001) > normRatio) {
    height = width / normRatio;
  } else {
    width = height * normRatio;
  }
  if (width > maxW) {
    width = maxW;
    height = width / normRatio;
  }
  if (height > maxH) {
    height = maxH;
    width = height * normRatio;
  }
  width = Math.max(MIN_CROP_SIZE, width);
  height = Math.max(MIN_CROP_SIZE, height);

  const x = handle.includes('w') ? right0 - width : origin.x;
  const y = handle.includes('n') ? bottom0 - height : origin.y;
  return { x: clamp(x, 0, 1 - width), y: clamp(y, 0, 1 - height), width, height };
}

function drawTransformedToCanvas(canvas, img, { rotation, flipH, brightness, contrast }) {
  const { width: outW, height: outH } = getRotatedDimensions(img.naturalWidth, img.naturalHeight, rotation);
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, outW, outH);
  ctx.save();
  ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
}

const WallpaperEditorModal = ({ wallpaper, isPreviewActive = false, onClose, onPreviewEdited, onApplyWallpaper, onSaveLocal }) => {
  const [aspectPreset, setAspectPreset] = useState('original');
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [imageReady, setImageReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('default');
  const [stageSize, setStageSize] = useState({ width: 640, height: 420 });

  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const dragRef = useRef(null);

  const getActiveRatio = useCallback((presetId, currentRotation) => {
    const preset = ASPECT_PRESETS.find(item => item.id === presetId);
    if (!preset) return null;
    if (preset.id === 'original' && imgRef.current) {
      const { width, height } = getRotatedDimensions(
        imgRef.current.naturalWidth,
        imgRef.current.naturalHeight,
        currentRotation
      );
      return height ? width / height : null;
    }
    return preset.ratio;
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const updateSize = () => {
      const width = Math.max(240, stage.clientWidth - 16);
      const height = Math.max(180, stage.clientHeight - 16);
      setStageSize({ width, height });
    };
    updateSize();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(stage);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    let active = true;
    setImageReady(false);
    setLoadError('');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!active) return;
      imgRef.current = img;
      setImageReady(true);
    };
    img.onerror = () => {
      if (!active) return;
      imgRef.current = null;
      setLoadError('无法加载图片进行编辑，请等待本地缓存完成后重试。');
    };
    img.src = wallpaper.imageUrl;
    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [wallpaper.imageUrl]);

  useEffect(() => {
    if (isPreviewActive) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!submitting) onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isPreviewActive, onClose, submitting]);

  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageReady) return;
    const { width: rotW, height: rotH } = getRotatedDimensions(img.naturalWidth, img.naturalHeight, rotation);
    const scale = Math.min(stageSize.width / rotW, stageSize.height / rotH);
    const viewW = Math.max(1, Math.round(rotW * scale));
    const viewH = Math.max(1, Math.round(rotH * scale));
    canvas.width = viewW;
    canvas.height = viewH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
    ctx.translate(viewW / 2, viewH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, 1);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    const cx = crop.x * viewW;
    const cy = crop.y * viewH;
    const cw = crop.width * viewW;
    const ch = crop.height * viewH;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.rect(cx, cy, cw, ch);
    ctx.fill('evenodd');

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx + 0.75, cy + 0.75, Math.max(0, cw - 1.5), Math.max(0, ch - 1.5));

    const handleLen = Math.min(14, cw / 4, ch / 4);
    if (handleLen >= 4) {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#ff00b4';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      // 四角 L 形手柄
      ctx.moveTo(cx + 1.5, cy + handleLen);
      ctx.lineTo(cx + 1.5, cy + 1.5);
      ctx.lineTo(cx + handleLen, cy + 1.5);
      ctx.moveTo(cx + cw - handleLen, cy + 1.5);
      ctx.lineTo(cx + cw - 1.5, cy + 1.5);
      ctx.lineTo(cx + cw - 1.5, cy + handleLen);
      ctx.moveTo(cx + 1.5, cy + ch - handleLen);
      ctx.lineTo(cx + 1.5, cy + ch - 1.5);
      ctx.lineTo(cx + handleLen, cy + ch - 1.5);
      ctx.moveTo(cx + cw - handleLen, cy + ch - 1.5);
      ctx.lineTo(cx + cw - 1.5, cy + ch - 1.5);
      ctx.lineTo(cx + cw - 1.5, cy + ch - handleLen);
      // 四边中点拖拽短条
      const midX = cx + cw / 2;
      const midY = cy + ch / 2;
      ctx.moveTo(midX - handleLen / 2, cy + 1.5);
      ctx.lineTo(midX + handleLen / 2, cy + 1.5);
      ctx.moveTo(midX - handleLen / 2, cy + ch - 1.5);
      ctx.lineTo(midX + handleLen / 2, cy + ch - 1.5);
      ctx.moveTo(cx + 1.5, midY - handleLen / 2);
      ctx.lineTo(cx + 1.5, midY + handleLen / 2);
      ctx.moveTo(cx + cw - 1.5, midY - handleLen / 2);
      ctx.lineTo(cx + cw - 1.5, midY + handleLen / 2);
      ctx.stroke();
    }
    ctx.restore();
  }, [imageReady, stageSize, rotation, flipH, brightness, contrast, crop]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  const handleAspectChange = presetId => {
    setAspectPreset(presetId);
    if (!imgRef.current || presetId === 'free') {
      if (presetId === 'original') setCrop(DEFAULT_CROP);
      return;
    }
    const { width, height } = getRotatedDimensions(imgRef.current.naturalWidth, imgRef.current.naturalHeight, rotation);
    const ratio = getActiveRatio(presetId, rotation);
    setCrop(computeCenteredCrop(width, height, ratio));
  };

  const handleRotate = delta => {
    const nextRotation = (rotation + delta + 360) % 360;
    setRotation(nextRotation);
    if (imgRef.current && aspectPreset !== 'free') {
      const { width, height } = getRotatedDimensions(imgRef.current.naturalWidth, imgRef.current.naturalHeight, nextRotation);
      const ratio = getActiveRatio(aspectPreset, nextRotation);
      setCrop(computeCenteredCrop(width, height, ratio));
    }
  };

  const handleReset = () => {
    setAspectPreset('original');
    setRotation(0);
    setFlipH(false);
    setBrightness(0);
    setContrast(0);
    setCrop(DEFAULT_CROP);
  };

  const getCanvasPoint = event => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return { nx: 0, ny: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      nx: clamp((event.clientX - rect.left) / (rect.width || 1), 0, 1),
      ny: clamp((event.clientY - rect.top) / (rect.height || 1), 0, 1)
    };
  };

  const handlePointerDown = event => {
    const canvas = previewCanvasRef.current;
    if (!imageReady || !canvas) return;
    const { nx, ny } = getCanvasPoint(event);
    const handle = hitTestCropHandle(nx, ny, crop, canvas.width, canvas.height);
    if (!handle) return;

    dragRef.current = {
      handle,
      startX: nx,
      startY: ny,
      originCrop: { ...crop }
    };
    setCursorStyle(HANDLE_CURSORS[handle] || 'default');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = event => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !imageReady) return;
    const { nx, ny } = getCanvasPoint(event);
    const drag = dragRef.current;

    if (!drag) {
      const hoverHandle = hitTestCropHandle(nx, ny, crop, canvas.width, canvas.height);
      setCursorStyle(hoverHandle ? HANDLE_CURSORS[hoverHandle] : 'default');
      return;
    }

    if (drag.handle === 'move') {
      const dx = nx - drag.startX;
      const dy = ny - drag.startY;
      const nextX = clamp(drag.originCrop.x + dx, 0, 1 - drag.originCrop.width);
      const nextY = clamp(drag.originCrop.y + dy, 0, 1 - drag.originCrop.height);
      setCrop({ ...drag.originCrop, x: nextX, y: nextY });
      return;
    }

    const ratio = getActiveRatio(aspectPreset, rotation);
    const canvasRatio = canvas.width / Math.max(1, canvas.height);
    const normRatio = ratio ? ratio / canvasRatio : null;
    setCrop(resizeCropByHandle(drag.originCrop, drag.handle, nx, ny, normRatio));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const exportEditedDataUrl = () => {
    const img = imgRef.current;
    if (!img) throw new Error('图片未就绪');
    const fullCanvas = document.createElement('canvas');
    drawTransformedToCanvas(fullCanvas, img, { rotation, flipH, brightness, contrast });

    const sx = Math.round(crop.x * fullCanvas.width);
    const sy = Math.round(crop.y * fullCanvas.height);
    const sw = Math.max(1, Math.round(crop.width * fullCanvas.width));
    const sh = Math.max(1, Math.round(crop.height * fullCanvas.height));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sw;
    outCanvas.height = sh;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('无法创建绘图上下文');
    outCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return outCanvas.toDataURL('image/png');
  };

  const handleAction = async handler => {
    if (!imageReady || submitting) return;
    setSubmitting(true);
    try {
      const dataUrl = exportEditedDataUrl();
      await handler({ dataUrl });
    } catch (error) {
      const message = error?.name === 'SecurityError'
        ? '当前图片受跨域限制，请等待本地缓存完成后再试。'
        : (error?.message || '导出图片失败');
      setLoadError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreviewClick = () => {
    if (!imageReady || submitting || !onPreviewEdited) return;
    try {
      const dataUrl = exportEditedDataUrl();
      onPreviewEdited(dataUrl);
    } catch (error) {
      const message = error?.name === 'SecurityError'
        ? '当前图片受跨域限制，请等待本地缓存完成后再试。'
        : (error?.message || '生成预览图失败');
      setLoadError(message);
    }
  };

  return (
    <div className="wallpaper-editor-overlay" onClick={() => !submitting && onClose()}>
      <div
        className="wallpaper-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallpaper-editor-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="wallpaper-editor-header">
          <h3 id="wallpaper-editor-title">编辑壁纸 · {wallpaper.id}</h3>
          <button
            type="button"
            className="wallpaper-editor-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭编辑器"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="wallpaper-editor-body">
          <div className="wallpaper-editor-stage" ref={stageRef}>
            {onPreviewEdited && (
              <button
                type="button"
                className="stage-preview-btn"
                onClick={handlePreviewClick}
                disabled={!imageReady || submitting}
                title="全屏预览编辑后的桌面效果"
                aria-label="预览编辑效果"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M15 3H21V9M9 21H3V15M21 3L14 10M3 21L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>预览</span>
              </button>
            )}
            {loadError ? (
              <div className="wallpaper-editor-error" role="alert">{loadError}</div>
            ) : (
              <canvas
                ref={previewCanvasRef}
                className="wallpaper-editor-canvas"
                style={{ cursor: cursorStyle }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={() => { if (!dragRef.current) setCursorStyle('default'); }}
              />
            )}
          </div>

          <div className="wallpaper-editor-controls">
            <div className="editor-section">
              <span className="editor-section-title">裁剪比例</span>
              <div className="editor-chip-grid">
                {ASPECT_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`editor-chip${aspectPreset === preset.id ? ' active' : ''}`}
                    onClick={() => handleAspectChange(preset.id)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="editor-section">
              <span className="editor-section-title">旋转与翻转</span>
              <div className="editor-chip-grid">
                <button type="button" className="editor-chip" onClick={() => handleRotate(-90)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M9 14L4 9L9 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 9H14.5C17.5 9 20 11.5 20 14.5C20 17.5 17.5 20 14.5 20H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  左旋
                </button>
                <button type="button" className="editor-chip" onClick={() => handleRotate(90)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M15 14L20 9L15 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M20 9H9.5C6.5 9 4 11.5 4 14.5C4 17.5 6.5 20 9.5 20H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  右旋
                </button>
                <button
                  type="button"
                  className={`editor-chip${flipH ? ' active' : ''}`}
                  onClick={() => setFlipH(prev => !prev)}
                >
                  翻转
                </button>
              </div>
            </div>

            <div className="editor-section">
              <span className="editor-section-title">画面调节</span>
              <div className="editor-slider-row">
                <label className="editor-slider-label" htmlFor="editor-brightness">
                  <span>亮度</span>
                  <span className="editor-slider-value">{formatAdjustment(brightness)}</span>
                </label>
                <input
                  id="editor-brightness"
                  type="range"
                  min="-50"
                  max="50"
                  value={brightness}
                  style={getBipolarTrackStyle(brightness)}
                  onChange={event => setBrightness(Number(event.target.value))}
                />
              </div>
              <div className="editor-slider-row">
                <label className="editor-slider-label" htmlFor="editor-contrast">
                  <span>对比度</span>
                  <span className="editor-slider-value">{formatAdjustment(contrast)}</span>
                </label>
                <input
                  id="editor-contrast"
                  type="range"
                  min="-50"
                  max="50"
                  value={contrast}
                  style={getBipolarTrackStyle(contrast)}
                  onChange={event => setContrast(Number(event.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="wallpaper-editor-footer">
          <button type="button" className="editor-btn secondary" onClick={handleReset} disabled={submitting}>
            重置参数
          </button>
          <div className="editor-footer-actions">
            <button
              type="button"
              className="editor-btn secondary"
              onClick={() => handleAction(onSaveLocal)}
              disabled={!imageReady || submitting}
            >
              另存为
            </button>
            <button
              type="button"
              className="editor-btn primary"
              onClick={() => handleAction(onApplyWallpaper)}
              disabled={!imageReady || submitting}
            >
              {submitting ? '处理中...' : '应用为壁纸'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WallpaperEditorModal;
