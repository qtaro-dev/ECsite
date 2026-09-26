import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { assertProductImageSize, assertSinglePageProductImage, inspectAndSanitizeProductImage, ProductImageValidationError } from '../../src/server/admin/product-images';

async function fixture(format: 'jpeg' | 'png' | 'webp', width = 3, height = 2) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#cc8844' } }).toFormat(format).toBuffer();
  return { bytes, type: `image/${format === 'jpeg' ? 'jpeg' : format}` };
}

describe('admin product image validation and sanitization', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('fully decodes and preserves %s format', async (format) => {
    const input = await fixture(format);
    const result = await inspectAndSanitizeProductImage(input.type, input.bytes.byteLength, input.bytes);
    const output = await sharp(result.bytes).metadata();
    expect(output.format).toBe(format);
    expect([output.width, output.height]).toEqual([3, 2]);
    expect(result.extension).toBe(format === 'jpeg' ? 'jpg' : format);
  });

  it('rejects MIME that does not match the decoded file format', async () => {
    const input = await fixture('png');
    await expect(inspectAndSanitizeProductImage('image/jpeg', input.bytes.byteLength, input.bytes))
      .rejects.toMatchObject({ reason: 'content' });
  });

  it('rejects corrupt or truncated content after header inspection', async () => {
    const input = await fixture('jpeg');
    const partial = input.bytes.subarray(0, Math.max(10, input.bytes.byteLength - 8));
    await expect(inspectAndSanitizeProductImage(input.type, partial.byteLength, partial))
      .rejects.toBeInstanceOf(ProductImageValidationError);
  });

  it('rejects extreme decoded dimensions before full decode', async () => {
    const input = await fixture('png', 8001, 1);
    await expect(inspectAndSanitizeProductImage(input.type, input.bytes.byteLength, input.bytes))
      .rejects.toMatchObject({ reason: 'dimensions' });
  });

  it('rejects animated or multipage image metadata', () => {
    expect(() => assertSinglePageProductImage(1)).not.toThrow();
    expect(() => assertSinglePageProductImage(undefined)).not.toThrow();
    expect(() => assertSinglePageProductImage(2)).toThrowError(ProductImageValidationError);
    expect(() => assertSinglePageProductImage(12)).toThrowError(ProductImageValidationError);
  });

  it('rejects a re-encoded output that exceeds the Storage bucket byte limit', () => {
    expect(() => assertProductImageSize(10 * 1024 * 1024)).not.toThrow();
    expect(() => assertProductImageSize(10 * 1024 * 1024 + 1)).toThrowError(ProductImageValidationError);
  });

  it('re-encodes without carrying EXIF metadata', async () => {
    const source = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#123456' } })
      .jpeg().withMetadata({ exif: {
        IFD0: { Artist: 'T37 test', ImageDescription: 'private metadata' },
        IFD2: { GPSLatitude: '35,0,0N', GPSLongitude: '139,0,0E' },
      } }).toBuffer();
    const inputMetadata = await sharp(source).metadata();
    expect(inputMetadata.exif).toBeInstanceOf(Buffer);
    const result = await inspectAndSanitizeProductImage('image/jpeg', source.byteLength, source);
    const output = await sharp(result.bytes).metadata();
    expect(output.format).toBe('jpeg');
    expect(output.exif).toBeUndefined();
    expect(output.iptc).toBeUndefined();
    expect(output.xmp).toBeUndefined();
  });
});
