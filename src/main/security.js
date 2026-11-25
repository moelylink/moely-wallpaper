export function parseExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error('Invalid URL');
  }
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported URL protocol');
  }
  return url;
}

export function validateImageUrl(value) {
  const url = parseExternalUrl(value);
  if (url.protocol !== 'https:') {
    throw new Error('Image URL must use HTTPS');
  }
  return url.href;
}

export function isAppUrl(value, entryUrl) {
  try {
    const url = new URL(value);
    const entry = new URL(entryUrl);
    return url.protocol === entry.protocol && url.host === entry.host &&
      url.pathname === entry.pathname && url.search === entry.search;
  } catch {
    return false;
  }
}

export function isRequestId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
}
