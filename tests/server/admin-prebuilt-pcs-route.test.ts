import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authorizeAdminApi, getAdminPrebuiltPcs, getPrebuiltPcById, saveAdminPrebuiltPc } = vi.hoisted(() => ({
  authorizeAdminApi: vi.fn(), getAdminPrebuiltPcs: vi.fn(), getPrebuiltPcById: vi.fn(), saveAdminPrebuiltPc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/admin/http', () => ({
  authorizeAdminApi,
  adminError: vi.fn((status: number, requestId: string) => Response.json({ error: { code: 'UNAVAILABLE' }, requestId }, { status })),
  adminSuccess: vi.fn((data: unknown, requestId: string) => Response.json({ data, requestId })),
}));
vi.mock('@/server/admin/prebuilt-pcs', () => ({ getAdminPrebuiltPcs, getPrebuiltPcById, saveAdminPrebuiltPc,
  PrebuiltPcSaveError: class PrebuiltPcSaveError extends Error { constructor(readonly code: string, readonly fieldErrors?: Record<string, string[]>) { super(code); } },
}));
import { GET, PATCH, POST } from '@/app/api/admin/prebuilt-pcs/route';
import { PrebuiltPcSaveError } from '@/server/admin/prebuilt-pcs';

const productId = '77777777-7777-4777-8777-777777777777';
const userId = '88888888-8888-4888-8888-888888888888';
const fields = { slug: 't58-prebuilt', sku: 'T58-PC', status: 'draft' };
function multipart(payload: unknown, method: 'POST' | 'PATCH') {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  return new NextRequest('https://shop.example/api/admin/prebuilt-pcs', { method, body: form, headers: { origin: 'https://shop.example' } });
}

describe('/api/admin/prebuilt-pcs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeAdminApi.mockResolvedValue({ access: { userId }, requestId: 'request-test' });
    getAdminPrebuiltPcs.mockResolvedValue([]);
    getPrebuiltPcById.mockResolvedValue({ id: productId });
    saveAdminPrebuiltPc.mockImplementation(async (input: { productId?: string }) => ({ productId: input.productId ?? productId, version: 0, images: [], cleanupPending: false }));
  });

  it('lists and reads only through the admin-authenticated route', async () => {
    const list = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-pcs'));
    if (!list) throw new Error('GET list returned no response');
    expect(list.status).toBe(200);
    expect(getAdminPrebuiltPcs).toHaveBeenCalled();
    const detail = await GET(new NextRequest(`https://shop.example/api/admin/prebuilt-pcs?productId=${productId}`));
    if (!detail) throw new Error('GET detail returned no response');
    expect(detail.status).toBe(200);
    expect(getPrebuiltPcById).toHaveBeenCalledWith(productId);
    authorizeAdminApi.mockResolvedValueOnce({ response: Response.json({}, { status: 403 }), requestId: 'request-denied' });
    const denied = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-pcs'));
    if (!denied) throw new Error('Denied GET returned no response');
    expect(denied.status).toBe(403);
  });

  it('creates a draft through the dedicated service and rejects linked-SKU or malformed component fields', async () => {
    const response = await POST(multipart({ fields, images: [], imageAltText: 'Prebuilt PC' }, 'POST'));
    if (!response) throw new Error('POST returned no response');
    expect(response.status).toBe(201);
    expect(saveAdminPrebuiltPc).toHaveBeenCalledWith(expect.objectContaining({ fields: expect.objectContaining({ slug: 't58-prebuilt' }), actorId: userId }));
    expect(authorizeAdminApi).toHaveBeenCalledWith(expect.anything(), true);

    const invalid = await POST(multipart({ fields: { ...fields, componentSku: 'CPU-SKU' }, images: [], imageAltText: 'Prebuilt PC' }, 'POST'));
    if (!invalid) throw new Error('Invalid POST returned no response');
    expect(invalid.status).toBe(400);
    expect(saveAdminPrebuiltPc).toHaveBeenCalledTimes(1);
  });

  it('updates with productId and expectedVersion and maps stale conflicts', async () => {
    const response = await PATCH(multipart({ productId, fields: { ...fields, expectedVersion: 3 }, images: [], imageAltText: 'Prebuilt PC' }, 'PATCH'));
    if (!response) throw new Error('PATCH returned no response');
    expect(response.status).toBe(200);
    expect(saveAdminPrebuiltPc).toHaveBeenCalledWith(expect.objectContaining({ productId, fields: expect.objectContaining({ expectedVersion: 3 }) }));
    saveAdminPrebuiltPc.mockRejectedValueOnce(new PrebuiltPcSaveError('CONFLICT'));
    const conflict = await PATCH(multipart({ productId, fields: { ...fields, expectedVersion: 3 }, images: [], imageAltText: 'Prebuilt PC' }, 'PATCH'));
    if (!conflict) throw new Error('Conflict PATCH returned no response');
    expect(conflict.status).toBe(409);
  });
});
