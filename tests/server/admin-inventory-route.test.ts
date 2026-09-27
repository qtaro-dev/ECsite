import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authorizeAdminApi, getAdminInventory, adjustAdminInventory } = vi.hoisted(() => ({
  authorizeAdminApi: vi.fn(), getAdminInventory: vi.fn(), adjustAdminInventory: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/admin/http', () => ({
  authorizeAdminApi,
  adminError: vi.fn((status: number, requestId: string) => Response.json({ error: { code: 'UNAVAILABLE' }, requestId }, { status })),
  adminSuccess: vi.fn((data: unknown, requestId: string) => Response.json({ data, requestId })),
}));
vi.mock('../../src/server/admin/inventory', () => ({
  getAdminInventory, adjustAdminInventory,
  InventoryAdjustmentError: class InventoryAdjustmentError extends Error { constructor(readonly status: string, readonly latest?: unknown) { super(status); } },
}));
import { GET, POST } from '../../src/app/api/admin/inventory/route';

const userId = '88888888-8888-4888-8888-888888888888';
const productId = '77777777-7777-4777-8777-777777777777';

describe('/api/admin/inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeAdminApi.mockResolvedValue({ access: { userId }, requestId: 'request-test' });
    getAdminInventory.mockResolvedValue({ items: [], adjustments: [], page: 2, pageSize: 50, total: 80, totalPages: 2 });
  });

  it('reads the requested bounded page', async () => {
    const response = await GET(new NextRequest('https://shop.example/api/admin/inventory?page=2'));
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(200);
    expect(getAdminInventory).toHaveBeenCalledWith(2);
  });

  it('rejects an invalid page without querying inventory', async () => {
    const response = await GET(new NextRequest('https://shop.example/api/admin/inventory?page=0'));
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(400);
    expect(getAdminInventory).not.toHaveBeenCalled();
  });

  it('requires same-origin active-admin authorization for a valid mutation', async () => {
    const request = new NextRequest('https://shop.example/api/admin/inventory', {
      method: 'POST', headers: { origin: 'https://shop.example', 'content-type': 'application/json' },
      body: JSON.stringify({ productId, delta: 3, reason: '入庫', expectedVersion: 2 }),
    });
    adjustAdminInventory.mockResolvedValue({ state: { productId, onHand: 3, allocated: 0, available: 3, version: 1 }, adjustmentId: '99999999-9999-4999-8999-999999999999', auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-09-27T00:00:00Z' });
    const response = await POST(request);
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(200);
    expect(authorizeAdminApi).toHaveBeenCalledWith(request, true);
    expect(adjustAdminInventory).toHaveBeenCalledWith({ productId, delta: 3, reason: '入庫', expectedVersion: 2 }, userId, 'request-test');
  });

  it('rejects zero or malformed stock deltas before reaching the database', async () => {
    const request = new NextRequest('https://shop.example/api/admin/inventory', {
      method: 'POST', headers: { origin: 'https://shop.example', 'content-type': 'application/json' },
      body: JSON.stringify({ productId, delta: 0, reason: '棚卸', expectedVersion: 0 }),
    });
    const response = await POST(request);
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(400);
    expect(adjustAdminInventory).not.toHaveBeenCalled();
  });
});
