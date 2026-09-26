import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, upload, remove, getAdminProduct, inspect } = vi.hoisted(() => ({
  rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), getAdminProduct: vi.fn(), inspect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/admin/overview', () => ({ createAdminDataClient: () => ({
  rpc,
  storage: { from: () => ({ upload, remove }) },
}) }));
vi.mock('../../src/server/admin/products', () => ({ getAdminProduct }));
vi.mock('../../src/server/admin/product-images', () => ({
  ProductImageValidationError: class ProductImageValidationError extends Error {},
  inspectAndSanitizeProductImage: inspect,
}));
import { ProductSaveError, saveAdminProduct } from '../../src/server/admin/save-product';

const adminId = '88888888-8888-4888-8888-888888888888';
const productId = '77777777-7777-4777-8777-777777777777';
const baseFields = {
  category: 'cpu' as const, slug: 'sample-cpu', sku: 'SAMPLE-CPU', name: '', brand: '', description: '', beginnerNote: '',
  priceTaxIncludedYen: null, status: 'draft' as const, weightG: null, packLengthMm: null, packWidthMm: null,
  packHeightMm: null, useCases: [] as ('gaming' | 'daily' | 'editing')[], specifications: {},
};

describe('admin product save service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation(async (_name: string, args: { p_product_id: string }) => ({ data: [{ product_id: args.p_product_id, version: 1 }], error: null }));
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    getAdminProduct.mockResolvedValue(null);
    inspect.mockResolvedValue({ extension: 'jpg', contentType: 'image/jpeg', width: 2, height: 2, bytes: new Uint8Array([1, 2, 3]) });
  });

  it('generates an id for creation and sends null expected version to the atomic RPC', async () => {
    const result = await saveAdminProduct({ fields: baseFields, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' });
    expect(result).toEqual({ productId: expect.stringMatching(/^[0-9a-f-]{36}$/i), version: 1, images: [], cleanupPending: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_save_product', expect.objectContaining({
      p_product_id: expect.stringMatching(/^[0-9a-f-]{36}$/i), p_expected_version: null, p_actor_id: adminId,
      p_fields: expect.objectContaining({ category_slug: 'cpu', slug: 'sample-cpu' }),
    }));
    expect(rpc.mock.calls[0][1].p_product_id).toBe(result.productId);
  });

  it('requires an existing product and keeps category immutable on update', async () => {
    getAdminProduct.mockResolvedValue({ id: productId, category: 'gpu', images: [] });
    await expect(saveAdminProduct({ productId, fields: { ...baseFields, expectedVersion: 4 }, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an image path that is not already owned by the product', async () => {
    getAdminProduct.mockResolvedValue({ id: productId, category: 'cpu', images: [{ storagePath: `${productId}/owned.jpg` }] });
    await expect(saveAdminProduct({ productId, fields: { ...baseFields, expectedVersion: 1 },
      images: [{ storagePath: 'other-product/secret.jpg', altText: 'image', sortOrder: 0 }], imageAltText: 'image', actorId: adminId, requestId: 'request' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects publishing without any current or newly uploaded image', async () => {
    await expect(saveAdminProduct({ fields: { ...baseFields, status: 'published' }, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', fieldErrors: { images: expect.any(Array) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the update version as the atomic optimistic-lock precondition', async () => {
    getAdminProduct.mockResolvedValue({ id: productId, category: 'cpu', images: [] });
    await saveAdminProduct({ productId, fields: { ...baseFields, expectedVersion: 9 }, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_product_id: productId, p_expected_version: 9 });
  });

  it('uploads only sanitized image bytes under the server generated product prefix', async () => {
    const imageFile = new File([new Uint8Array([8, 9])], 'source.jpg', { type: 'image/jpeg' });
    const result = await saveAdminProduct({ fields: baseFields, images: [], imageAltText: 'front view', imageFile, actorId: adminId, requestId: 'request' });
    expect(inspect).toHaveBeenCalledWith('image/jpeg', 2, new Uint8Array([8, 9]));
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${result.productId}/[0-9a-f-]{36}\\.jpg$`, 'i')),
      new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    expect(rpc.mock.calls[0][1].p_images).toEqual([{
      storage_path: expect.stringMatching(new RegExp(`^${result.productId}/[0-9a-f-]{36}\\.jpg$`, 'i')),
      alt_text: 'front view',
      sort_order: 0,
    }]);
  });

  it('maps stale version and unclaimed-id conflicts without exposing database details', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'private database detail' } });
    await expect(saveAdminProduct({ fields: baseFields, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' }))
      .rejects.toBeInstanceOf(ProductSaveError);
    await expect(saveAdminProduct({ fields: baseFields, images: [], imageAltText: 'image', actorId: adminId, requestId: 'request' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
