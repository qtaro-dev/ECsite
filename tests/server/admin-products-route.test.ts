import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authorizeAdminApi, getAdminProducts, saveAdminProduct } = vi.hoisted(() => ({
  authorizeAdminApi: vi.fn(), getAdminProducts: vi.fn(), saveAdminProduct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/admin/http', () => ({
  authorizeAdminApi,
  adminError: vi.fn((_status: number, requestId: string) => Response.json({ error: { code: 'UNAVAILABLE' }, requestId }, { status: 503 })),
  adminSuccess: vi.fn((data: unknown, requestId: string) => Response.json({ data, requestId })),
}));
vi.mock('../../src/server/admin/products', () => ({ getAdminProducts }));
vi.mock('../../src/server/admin/save-product', () => ({
  ProductSaveError: class ProductSaveError extends Error { constructor(readonly code: string, readonly fieldErrors?: Record<string, string[]>) { super(code); } },
  saveAdminProduct,
}));
import { PATCH, POST } from '../../src/app/api/admin/products/route';
import { ProductSaveError } from '../../src/server/admin/save-product';
import { ADMIN_PRODUCT_MULTIPART_MAX_BYTES } from '../../src/lib/admin-product-image-limits';

const productId = '77777777-7777-4777-8777-777777777777';
const userId = '88888888-8888-4888-8888-888888888888';
const base = {
  category: 'cpu', slug: 'sample-cpu', sku: 'SAMPLE-CPU', status: 'draft', specifications: {},
};
function multipart(payload: unknown, method: 'POST' | 'PATCH') {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  return new NextRequest('https://shop.example/api/admin/products', { method, body: form, headers: { origin: 'https://shop.example' } });
}

describe('/api/admin/products mutation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeAdminApi.mockResolvedValue({ access: { userId }, requestId: 'request-test' });
    saveAdminProduct.mockImplementation(async (input: { productId?: string }) => ({ productId: input.productId ?? productId, version: 1, images: [], cleanupPending: false }));
  });

  it('POST creates and rejects any caller supplied product id', async () => {
    const response = await POST(multipart({ fields: base, images: [], imageAltText: 'image' }, 'POST'));
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(201);
    expect(saveAdminProduct).toHaveBeenCalledWith(expect.objectContaining({ fields: expect.objectContaining({ slug: 'sample-cpu' }), actorId: userId }));
    const invalid = await POST(multipart({ productId, fields: base, images: [], imageAltText: 'image' }, 'POST'));
    expect(invalid).toBeDefined();
    if (!invalid) return;
    expect(invalid.status).toBe(400);
  });

  it('PATCH updates only through the collection endpoint with productId and expectedVersion', async () => {
    const response = await PATCH(multipart({ productId, fields: { ...base, expectedVersion: 4 }, images: [], imageAltText: 'image' }, 'PATCH'));
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(200);
    expect(saveAdminProduct).toHaveBeenCalledWith(expect.objectContaining({ productId, fields: expect.objectContaining({ expectedVersion: 4 }), actorId: userId }));
    const invalid = await PATCH(multipart({ fields: { ...base, expectedVersion: 4 }, images: [], imageAltText: 'image' }, 'PATCH'));
    expect(invalid).toBeDefined();
    if (!invalid) return;
    expect(invalid.status).toBe(400);
  });

  it('returns safe, field-specific image validation errors', async () => {
    saveAdminProduct.mockRejectedValueOnce(new ProductSaveError('BAD_REQUEST', { image: ['アニメーション画像は登録できません。'] }));
    const form = new FormData();
    form.set('payload', JSON.stringify({ fields: base, images: [], imageAltText: 'image' }));
    form.set('image', new File([new Uint8Array([1, 2, 3])], 'animated.webp', { type: 'image/webp' }));
    const response = await POST(new NextRequest('https://shop.example/api/admin/products', {
      method: 'POST', body: form, headers: { origin: 'https://shop.example' },
    }));
    expect(response).toBeDefined();
    if (!response) return;
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: 'BAD_REQUEST', fieldErrors: { image: ['アニメーション画像は登録できません。'] } });
  });

  it('rejects a declared multipart body over the limit before parsing', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify({ fields: base, images: [], imageAltText: 'image' }));
    const request = new NextRequest('https://shop.example/api/admin/products', {
      method: 'POST', body: form,
      headers: { origin: 'https://shop.example', 'content-length': String(ADMIN_PRODUCT_MULTIPART_MAX_BYTES + 1) },
    });
    const response = await POST(request);
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(413);
    expect(saveAdminProduct).not.toHaveBeenCalled();
  });

  it('checks received bytes when Content-Length is absent', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify({ fields: base, images: [], imageAltText: 'image' }));
    form.set('image', new File([new Uint8Array(ADMIN_PRODUCT_MULTIPART_MAX_BYTES)], 'large.jpg', { type: 'image/jpeg' }));
    const request = new NextRequest('https://shop.example/api/admin/products', {
      method: 'POST', body: form, headers: { origin: 'https://shop.example' },
    });
    expect(request.headers.get('content-length')).toBeNull();
    const response = await POST(request);
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(413);
    expect(saveAdminProduct).not.toHaveBeenCalled();
  });

  it('returns a field error when the image file exceeds 4,000,000 bytes', async () => {
    const form = new FormData();
    form.set('payload', JSON.stringify({ fields: base, images: [], imageAltText: 'image' }));
    form.set('image', new File([new Uint8Array(4_000_001)], 'too-large.jpg', { type: 'image/jpeg' }));
    const response = await POST(new NextRequest('https://shop.example/api/admin/products', {
      method: 'POST', body: form, headers: { origin: 'https://shop.example' },
    }));
    expect(response).toBeDefined();
    if (!response) return;
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.fieldErrors.image).toContain('画像は4,000,000 bytes（約4MB）以下にしてください。');
    expect(saveAdminProduct).not.toHaveBeenCalled();
  });
});
