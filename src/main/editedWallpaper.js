const MAX_EDITED_IMAGE_BYTES = 32 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

/**
 * Validates and decodes an edited image data URL sent from the renderer.
 */
export function decodeEditedImagePayload(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.dataUrl !== 'string') {
    throw new Error('Invalid edited image payload');
  }
  const match = DATA_URL_PATTERN.exec(payload.dataUrl);
  if (!match) {
    throw new Error('Unsupported edited image format');
  }
  const mimeType = match[1];
  const base64Body = match[2];
  const estimatedBytes = Math.floor((base64Body.length * 3) / 4);
  if (estimatedBytes === 0 || estimatedBytes > MAX_EDITED_IMAGE_BYTES) {
    throw new Error('Edited image exceeds size limit');
  }
  const buffer = Buffer.from(base64Body, 'base64');
  if (!buffer.length || buffer.length > MAX_EDITED_IMAGE_BYTES) {
    throw new Error('Edited image exceeds size limit');
  }
  return {
    buffer,
    mimeType,
    ext: mimeType === 'image/png' ? '.png' : '.jpg'
  };
}
