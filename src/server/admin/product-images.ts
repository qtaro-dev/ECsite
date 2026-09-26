import 'server-only';
import sharp from 'sharp';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES, ADMIN_PRODUCT_IMAGE_MAX_PIXELS, ADMIN_PRODUCT_IMAGE_MAX_SIDE } from '@/lib/admin-product-image-limits';

const formats = new Map([
  ['image/jpeg', { extension: 'jpg', format: 'jpeg' as const }],
  ['image/png', { extension: 'png', format: 'png' as const }],
  ['image/webp', { extension: 'webp', format: 'webp' as const }],
]);

export class ProductImageValidationError extends Error {
  constructor(readonly reason: 'type' | 'size' | 'dimensions' | 'content' | 'animated') { super(reason); }
}

export function isMultiPageProductImage(pages: number | undefined) { return (pages ?? 1) > 1; }
export function assertSinglePageProductImage(pages: number | undefined) {
  if (isMultiPageProductImage(pages)) throw new ProductImageValidationError('animated');
}
export function assertProductImageSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > ADMIN_PRODUCT_IMAGE_MAX_BYTES) {
    throw new ProductImageValidationError('size');
  }
}

export async function inspectAndSanitizeProductImage(type: string, size: number, bytes: Uint8Array) {
  const accepted = formats.get(type);
  if (!accepted) throw new ProductImageValidationError('type');
  assertProductImageSize(size);
  if (bytes.byteLength !== size) throw new ProductImageValidationError('size');
  try {
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const options = { failOn: 'warning' as const, limitInputPixels: ADMIN_PRODUCT_IMAGE_MAX_PIXELS };
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== accepted.format) throw new ProductImageValidationError('content');
    assertSinglePageProductImage(metadata.pages);
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width > ADMIN_PRODUCT_IMAGE_MAX_SIDE || height > ADMIN_PRODUCT_IMAGE_MAX_SIDE
      || width * height > ADMIN_PRODUCT_IMAGE_MAX_PIXELS) throw new ProductImageValidationError('dimensions');

    // Decode the complete source with strict truncation handling, apply EXIF
    // orientation, and re-encode in the submitted format. Sharp strips metadata
    // by default, including EXIF GPS coordinates, before private Storage upload.
    const sanitized = await sharp(input, options).rotate()
      .resize({ width: ADMIN_PRODUCT_IMAGE_MAX_SIDE, height: ADMIN_PRODUCT_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .toFormat(accepted.format, accepted.format === 'jpeg' ? { quality: 90 } : accepted.format === 'webp' ? { quality: 90 } : {})
      .toBuffer();
    assertProductImageSize(sanitized.byteLength);
    return { extension: accepted.extension, contentType: type, width, height, bytes: new Uint8Array(sanitized) };
  } catch (error) {
    if (error instanceof ProductImageValidationError) throw error;
    throw new ProductImageValidationError('content');
  }
}
