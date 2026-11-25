import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEditedImagePayload } from '../src/main/editedWallpaper.js';

describe('decodeEditedImagePayload', () => {
  it('decodes valid png and jpeg data URLs', () => {
    const sample = Buffer.from('fake-png-bytes').toString('base64');
    const png = decodeEditedImagePayload({ dataUrl: `data:image/png;base64,${sample}` });
    assert.equal(png.ext, '.png');
    assert.equal(png.mimeType, 'image/png');
    assert.equal(png.buffer.toString(), 'fake-png-bytes');

    const jpg = decodeEditedImagePayload({ dataUrl: `data:image/jpeg;base64,${sample}` });
    assert.equal(jpg.ext, '.jpg');
    assert.equal(jpg.mimeType, 'image/jpeg');
  });

  it('rejects unsupported formats or malformed payloads', () => {
    assert.throws(() => decodeEditedImagePayload(null), /Invalid edited image payload/);
    assert.throws(() => decodeEditedImagePayload({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), /Unsupported edited image format/);
    assert.throws(() => decodeEditedImagePayload({ dataUrl: 'https://example.com/a.png' }), /Unsupported edited image format/);
  });
});
