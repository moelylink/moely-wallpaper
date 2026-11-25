export const DEFAULT_THEME_COLOR = '#ff00b4';

export const PRESET_THEME_COLORS = [
  { name: '萌哩粉', value: '#ff00b4' },
  { name: '樱花桃', value: '#ff4d8d' },
  { name: '晴空蓝', value: '#2f8cff' },
  { name: '青柠绿', value: '#14b87a' },
  { name: '紫罗兰', value: '#8b5cf6' },
  { name: '琥珀橙', value: '#f59e0b' }
];

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function hexToRgbTuple(hex) {
  const normalized = normalizeHexColor(hex) || DEFAULT_THEME_COLOR;
  const intVal = parseInt(normalized.slice(1), 16);
  return [
    (intVal >> 16) & 255,
    (intVal >> 8) & 255,
    intVal & 255
  ];
}

export function hexToRgbString(hex) {
  return hexToRgbTuple(hex).join(', ');
}

export function deriveHoverRgbString(hex) {
  const [r, g, b] = hexToRgbTuple(hex);
  const lighten = channel => Math.min(255, Math.round(channel + (255 - channel) * 0.2));
  return `${lighten(r)}, ${lighten(g)}, ${lighten(b)}`;
}

export function applyThemeColorToDocument(color, rootElement = typeof document !== 'undefined' ? document.documentElement : null) {
  const normalized = normalizeHexColor(color) || DEFAULT_THEME_COLOR;
  if (!rootElement) return normalized;
  const rgb = hexToRgbString(normalized);
  const hoverRgb = deriveHoverRgbString(normalized);
  rootElement.style.setProperty('--primary-rgb', rgb);
  rootElement.style.setProperty('--primary-hover-rgb', hoverRgb);
  rootElement.style.setProperty('--primary-color', `rgb(${rgb})`);
  rootElement.style.setProperty('--primary-hover', `rgb(${hoverRgb})`);
  rootElement.style.setProperty('--primary-light', `rgba(${rgb}, 0.1)`);
  rootElement.style.setProperty('--primary-medium', `rgba(${rgb}, 0.3)`);
  return normalized;
}
