import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AdminProductCreate, AdminProductUpdate } from '@/lib/admin-product-schemas';
import { createAdminDataClient } from '@/server/admin/overview';
import { getAdminProduct } from '@/server/admin/products';
import { inspectAndSanitizeProductImage, ProductImageValidationError } from '@/server/admin/product-images';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES } from '@/lib/admin-product-image-limits';

type ImageInput = { storagePath: string; altText: string; sortOrder: number };
type SaveProductInput = {
  productId?: string;
  fields: AdminProductCreate | AdminProductUpdate;
  images: ImageInput[];
  imageAltText: string;
  imageFile?: File;
  actorId: string;
  requestId: string;
};
type RpcError = { code?: string; message?: string };

export class ProductSaveError extends Error {
  constructor(readonly code: 'BAD_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'UNAVAILABLE', readonly fieldErrors?: Record<string, string[]>) { super(code); }
}

function imageValidationMessage(reason: ProductImageValidationError['reason']) {
  if (reason === 'type') return 'JPEG、PNG、WebP形式の画像を選択してください。';
  if (reason === 'size') return '画像は4,000,000 bytes（約4MB）以下にしてください。';
  if (reason === 'dimensions') return '画像は各辺8,000px以下、総画素2,400万以下にしてください。';
  if (reason === 'animated') return 'アニメーションや複数ページ画像は登録できません。';
  return '画像データを読み取れません。対応形式の画像を選び直してください。';
}

export function productFieldsForDatabase(fields: AdminProductCreate | AdminProductUpdate) {
  return {
    category_slug: fields.category,
    slug: fields.slug,
    sku: fields.sku,
    name: fields.name,
    brand: fields.brand,
    description: fields.description,
    beginner_note: fields.beginnerNote,
    price_tax_included_yen: fields.priceTaxIncludedYen ?? null,
    status: fields.status,
    weight_g: fields.weightG ?? null,
    pack_length_mm: fields.packLengthMm ?? null,
    pack_width_mm: fields.packWidthMm ?? null,
    pack_height_mm: fields.packHeightMm ?? null,
  };
}

function mapRpcError(error: RpcError): ProductSaveError {
  if (error.code === 'P0001' || error.code === '23505') return new ProductSaveError('CONFLICT');
  if (error.code === 'P0002') return new ProductSaveError('NOT_FOUND');
  if (error.code?.startsWith('22') || error.code === '23502' || error.code === '23514') return new ProductSaveError('BAD_REQUEST');
  if (error.code === '42501') return new ProductSaveError('FORBIDDEN');
  return new ProductSaveError('UNAVAILABLE');
}

export async function saveAdminProduct(input: SaveProductInput) {
  const client = createAdminDataClient();
  const isCreate = input.productId === undefined;
  const fields = input.fields;
  const productId = input.productId ?? randomUUID();
  const expectedVersion = isCreate ? null : (fields as AdminProductUpdate).expectedVersion;
  const existing = isCreate ? null : await getAdminProduct(productId);
  if (!isCreate && !existing) throw new ProductSaveError('NOT_FOUND');
  if (!isCreate && existing?.category !== fields.category) throw new ProductSaveError('BAD_REQUEST');
  if (isCreate && input.images.length) throw new ProductSaveError('BAD_REQUEST');
  const oldPaths = new Set(existing?.images.map((image) => image.storagePath) ?? []);
  if (input.images.some((image) => !oldPaths.has(image.storagePath))) throw new ProductSaveError('BAD_REQUEST');
  if (fields.status === 'published' && input.images.length === 0 && !input.imageFile) {
    throw new ProductSaveError('BAD_REQUEST', { images: ['公開には少なくとも1枚の商品画像が必要です。'] });
  }

  const imageRows = input.images.map((image, index) => ({ ...image, sortOrder: index }));
  let uploadedPath: string | null = null;
  if (input.imageFile) {
    if (input.imageFile.size < 1 || input.imageFile.size > ADMIN_PRODUCT_IMAGE_MAX_BYTES) {
      throw new ProductSaveError('BAD_REQUEST', { image: [imageValidationMessage('size')] });
    }
    const bytes = new Uint8Array(await input.imageFile.arrayBuffer());
    let inspection: Awaited<ReturnType<typeof inspectAndSanitizeProductImage>>;
    try { inspection = await inspectAndSanitizeProductImage(input.imageFile.type, input.imageFile.size, bytes); }
    catch (error) {
      if (error instanceof ProductImageValidationError) throw new ProductSaveError('BAD_REQUEST', { image: [imageValidationMessage(error.reason)] });
      throw error;
    }
    uploadedPath = `${productId}/${randomUUID()}.${inspection.extension}`;
    const { error: uploadError } = await client.storage.from('product-images').upload(uploadedPath, inspection.bytes, {
      contentType: inspection.contentType, upsert: false, cacheControl: '3600',
    });
    if (uploadError) throw new ProductSaveError('UNAVAILABLE');
    imageRows.push({ storagePath: uploadedPath, altText: input.imageAltText, sortOrder: imageRows.length });
  }
  if (fields.status === 'published' && imageRows.length === 0) {
    throw new ProductSaveError('BAD_REQUEST', { images: ['公開には少なくとも1枚の商品画像が必要です。'] });
  }

  const { data, error } = await client.rpc('admin_save_product', {
    p_product_id: productId,
    p_expected_version: expectedVersion,
    p_fields: productFieldsForDatabase(fields),
    p_specifications: fields.specifications,
    p_use_cases: fields.useCases,
    p_images: imageRows,
    p_actor_id: input.actorId,
    p_request_id: input.requestId,
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (uploadedPath && mapped.code !== 'UNAVAILABLE') {
      await client.storage.from('product-images').remove([uploadedPath]);
    }
    throw mapped;
  }
  const saved = Array.isArray(data) ? data[0] as { product_id?: string; version?: number } | undefined : undefined;
  if (saved?.product_id !== productId || !Number.isInteger(saved.version)) throw new ProductSaveError('UNAVAILABLE');

  const retainedPaths = new Set(imageRows.map((image) => image.storagePath));
  const removedPaths = existing?.images.map((image) => image.storagePath).filter((path) => !retainedPaths.has(path)) ?? [];
  let cleanupPending = false;
  if (removedPaths.length) {
    const { error: cleanupError } = await client.storage.from('product-images').remove(removedPaths);
    cleanupPending = Boolean(cleanupError);
  }
  return { productId, version: saved.version!, images: imageRows.map(({ storagePath, altText }) => ({ storagePath, altText })), cleanupPending };
}
