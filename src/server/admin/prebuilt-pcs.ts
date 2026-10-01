import 'server-only';
import { randomUUID } from 'node:crypto';
import { AdminPrebuiltPcListSchema, type AdminPrebuiltPcCreate, type AdminPrebuiltPcUpdate } from '@/lib/admin-prebuilt-pc-schemas';
import { IdSchema } from '@/lib/schemas';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES } from '@/lib/admin-product-image-limits';
import { createAdminDataClient } from '@/server/admin/overview';
import { getAdminPrebuiltPc } from '@/server/admin/prebuilt-pc-read';
import { inspectAndSanitizeProductImage, ProductImageValidationError } from '@/server/admin/product-images';

type ImageInput = { storagePath: string; altText: string; sortOrder: number };
type SaveInput = {
  productId?: string; fields: AdminPrebuiltPcCreate | AdminPrebuiltPcUpdate; images: ImageInput[];
  imageAltText: string; imageFile?: File; actorId: string; requestId: string;
};
type RpcError = { code?: string };

export class PrebuiltPcSaveError extends Error {
  constructor(readonly code: 'BAD_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'UNAVAILABLE', readonly fieldErrors?: Record<string, string[]>) { super(code); }
}

function mapRpcError(error: RpcError): PrebuiltPcSaveError {
  if (error.code === 'P0001' || error.code === '23505') return new PrebuiltPcSaveError('CONFLICT');
  if (error.code === 'P0002') return new PrebuiltPcSaveError('NOT_FOUND');
  if (error.code?.startsWith('22') || error.code === '23502' || error.code === '23514') return new PrebuiltPcSaveError('BAD_REQUEST');
  if (error.code === '42501') return new PrebuiltPcSaveError('FORBIDDEN');
  return new PrebuiltPcSaveError('UNAVAILABLE');
}

function imageMessage(reason: ProductImageValidationError['reason']) {
  if (reason === 'type') return 'JPEG、PNG、WebP形式の画像を選択してください。';
  if (reason === 'size') return '画像は4,000,000 bytes（約4MB）以下にしてください。';
  if (reason === 'stored-size') return '画像を自動リサイズ・圧縮しても1MiB以下にできませんでした。小さめの画像を選択してください。';
  if (reason === 'dimensions') return '画像は各辺8,000px以下、総画素2,400万以下にしてください。';
  if (reason === 'animated') return 'アニメーションや複数ページ画像は登録できません。';
  return '画像データを読み取れません。対応形式の画像を選び直してください。';
}

export async function getAdminPrebuiltPcs(query = '') {
  const client = createAdminDataClient();
  const search = query.trim().replace(/[\\%_(),]/g, '\\$&');
  let request = client.from('products').select('id,slug,sku,name,brand,price_tax_included_yen,status,version,updated_at')
    .eq('category_id', await prebuiltCategoryId(client)).is('deleted_at', null).order('updated_at', { ascending: false }).limit(100);
  if (search) request = request.or(`name.ilike.%${search}%,brand.ilike.%${search}%,slug.ilike.%${search}%,sku.ilike.%${search}%`);
  const { data, error } = await request;
  if (error) throw new Error('Prebuilt PC list unavailable');
  const ids = (data ?? []).map((row) => row.id);
  const [specs, refs] = ids.length ? await Promise.all([
    client.from('prebuilt_pc_specs').select('product_id').in('product_id', ids),
    client.from('prebuilt_pc_component_parts').select('prebuilt_product_id').in('prebuilt_product_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (specs.error || refs.error) throw new Error('Prebuilt PC legacy state unavailable');
  const specified = new Set((specs.data ?? []).map((row) => row.product_id));
  const selected = new Set((refs.data ?? []).map((row) => row.prebuilt_product_id));
  return AdminPrebuiltPcListSchema.parse((data ?? []).map((row) => ({
    id: row.id, slug: row.slug, sku: row.sku, name: row.name, brand: row.brand,
    priceTaxIncludedYen: row.price_tax_included_yen, status: row.status, version: row.version, updatedAt: row.updated_at,
    legacyComponents: specified.has(row.id) && !selected.has(row.id),
  })));
}

async function prebuiltCategoryId(client: ReturnType<typeof createAdminDataClient>) {
  const { data, error } = await client.from('categories').select('id').eq('slug', 'prebuilt-pc').maybeSingle();
  if (error || !data) throw new Error('Prebuilt PC category unavailable');
  return data.id;
}

export async function saveAdminPrebuiltPc(input: SaveInput) {
  const client = createAdminDataClient();
  const isCreate = input.productId === undefined;
  const productId = input.productId ?? randomUUID();
  const fields = input.fields;
  const expectedVersion = isCreate ? null : (fields as AdminPrebuiltPcUpdate).expectedVersion;
  const existing = isCreate ? null : await getAdminPrebuiltPc(productId);
  if (!isCreate && !existing) throw new PrebuiltPcSaveError('NOT_FOUND');
  if (isCreate && input.images.length) throw new PrebuiltPcSaveError('BAD_REQUEST');
  if (input.images.some((image) => !(existing?.images.some((old) => old.storagePath === image.storagePath)))) throw new PrebuiltPcSaveError('BAD_REQUEST');
  if (fields.status === 'published' && input.images.length === 0 && !input.imageFile) {
    throw new PrebuiltPcSaveError('BAD_REQUEST', { images: ['公開には少なくとも1枚の商品画像が必要です。'] });
  }

  const imageRows = input.images.map((image, index) => ({ ...image, sortOrder: index }));
  let uploadedPath: string | null = null;
  if (input.imageFile) {
    if (input.imageFile.size < 1 || input.imageFile.size > ADMIN_PRODUCT_IMAGE_MAX_BYTES) throw new PrebuiltPcSaveError('BAD_REQUEST', { image: ['画像は4,000,000 bytes（約4MB）以下にしてください。'] });
    let sanitized: Awaited<ReturnType<typeof inspectAndSanitizeProductImage>>;
    try { sanitized = await inspectAndSanitizeProductImage(input.imageFile.type, input.imageFile.size, new Uint8Array(await input.imageFile.arrayBuffer())); }
    catch (error) {
      if (error instanceof ProductImageValidationError) throw new PrebuiltPcSaveError('BAD_REQUEST', { image: [imageMessage(error.reason)] });
      throw error;
    }
    uploadedPath = `${productId}/${randomUUID()}.${sanitized.extension}`;
    const { error } = await client.storage.from('product-images').upload(uploadedPath, sanitized.bytes, { contentType: sanitized.contentType, upsert: false, cacheControl: '3600' });
    if (error) throw new PrebuiltPcSaveError('UNAVAILABLE');
    imageRows.push({ storagePath: uploadedPath, altText: input.imageAltText, sortOrder: imageRows.length });
  }
  if (fields.status === 'published' && imageRows.length === 0) throw new PrebuiltPcSaveError('BAD_REQUEST', { images: ['公開には少なくとも1枚の商品画像が必要です。'] });

  const { data, error } = await client.rpc('admin_save_prebuilt_pc_v2', {
    p_product_id: productId,
    p_expected_version: expectedVersion,
    p_fields: {
      slug: fields.slug, sku: fields.sku, name: fields.name, brand: fields.brand,
      description: fields.description, beginner_note: fields.beginnerNote,
      price_tax_included_yen: fields.priceTaxIncludedYen ?? null, status: fields.status,
      weight_g: fields.weightG ?? null, pack_length_mm: fields.packLengthMm ?? null,
      pack_width_mm: fields.packWidthMm ?? null, pack_height_mm: fields.packHeightMm ?? null,
    },
    p_part_ids: fields.partIds ?? null,
    p_use_cases: fields.useCases,
    p_images: imageRows.map(({ storagePath, altText, sortOrder }) => ({ storage_path: storagePath, alt_text: altText, sort_order: sortOrder })),
    p_actor_id: input.actorId,
    p_request_id: input.requestId,
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (uploadedPath && mapped.code !== 'UNAVAILABLE') await client.storage.from('product-images').remove([uploadedPath]);
    throw mapped;
  }
  const saved = Array.isArray(data) ? data[0] as { product_id?: string; version?: number } | undefined : undefined;
  if (saved?.product_id !== productId || !Number.isInteger(saved.version)) throw new PrebuiltPcSaveError('UNAVAILABLE');
  const retained = new Set(imageRows.map((image) => image.storagePath));
  const removed = existing?.images.map((image) => image.storagePath).filter((path) => !retained.has(path)) ?? [];
  let cleanupPending = false;
  if (removed.length) cleanupPending = Boolean((await client.storage.from('product-images').remove(removed)).error);
  return { productId, version: saved.version!, images: imageRows, cleanupPending };
}

export async function getPrebuiltPcById(productId: string) {
  if (!IdSchema.safeParse(productId).success) return null;
  return getAdminPrebuiltPc(productId);
}
