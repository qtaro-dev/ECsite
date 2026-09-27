import 'server-only';
import sharp from 'sharp';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES, ADMIN_PRODUCT_IMAGE_MAX_PIXELS, ADMIN_PRODUCT_IMAGE_MAX_SIDE, ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES } from '@/lib/admin-product-image-limits';

const formats = new Map([
  ['image/jpeg', { extension: 'jpg', format: 'jpeg' as const }],
  ['image/png', { extension: 'png', format: 'png' as const }],
  ['image/webp', { extension: 'webp', format: 'webp' as const }],
]);

export class ProductImageValidationError extends Error {
  constructor(readonly reason: 'type' | 'size' | 'stored-size' | 'dimensions' | 'content' | 'animated') { super(reason); }
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

export function assertStoredProductImageSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES) {
    throw new ProductImageValidationError('stored-size');
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
    // Try quality reductions before reducing dimensions to retain as much detail
    // as possible while guaranteeing the stored-object limit.
    let outputWidth = width;
    let outputHeight = height;
    const qualities = accepted.format === 'png' ? [undefined] : [90, 80, 70, 60, 50, 40];
    for (let attempt = 0; attempt < 12; attempt++) {
      let lastEncodedSize = 0;
      for (const quality of qualities) {
        const encoded = await sharp(input, options).rotate()
          .resize({ width: outputWidth, height: outputHeight, fit: 'inside', withoutEnlargement: true })
          .toFormat(accepted.format, accepted.format === 'png'
            ? { compressionLevel: 9, adaptiveFiltering: true }
            : { quality: quality ?? 90 })
          .toBuffer();
        lastEncodedSize = encoded.byteLength;
        if (lastEncodedSize <= ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES) {
          assertStoredProductImageSize(lastEncodedSize);
          const outputMetadata = await sharp(encoded).metadata();
          if (outputMetadata.format !== accepted.format) throw new ProductImageValidationError('content');
          return {
            extension: accepted.extension,
            contentType: type,
            width: outputMetadata.width ?? 0,
            height: outputMetadata.height ?? 0,
            bytes: new Uint8Array(encoded),
          };
        }
      }

      if (outputWidth === 1 && outputHeight === 1) break;
      const scale = Math.min(0.95, Math.max(0.65,
        Math.sqrt(ADMIN_PRODUCT_IMAGE_MAX_STORED_BYTES / lastEncodedSize) * 0.95));
      const nextWidth = Math.max(1, Math.floor(outputWidth * scale));
      const nextHeight = Math.max(1, Math.floor(outputHeight * scale));
      outputWidth = nextWidth === outputWidth && outputWidth > 1 ? outputWidth - 1 : nextWidth;
      outputHeight = nextHeight === outputHeight && outputHeight > 1 ? outputHeight - 1 : nextHeight;
    }
    throw new ProductImageValidationError('stored-size');
  } catch (error) {
    if (error instanceof ProductImageValidationError) throw error;
    throw new ProductImageValidationError('content');
  }
}
