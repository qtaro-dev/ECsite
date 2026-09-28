import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createMemberClient: vi.fn(), createServiceClient: vi.fn(), userId: '00000000-0000-4000-8000-000000000001' as string | null, rpc: vi.fn() }));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createMemberClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createServiceClient }));

import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/checkout/cart-cleanup/route';

const orderId = '00000000-0000-4000-8000-000000000002';
function request(body: unknown = { orderId }, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/checkout/cart-cleanup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/checkout/cart-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.userId = '00000000-0000-4000-8000-000000000001';
    mocks.createMemberClient.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: mocks.userId ? { id: mocks.userId } : null }, error: null })) } });
    mocks.createServiceClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: { status: 'cleared', clearedLines: 1 }, error: null });
  });
  it('requires same origin, valid UUID and an authenticated owner', async () => {
    expect((await POST(request({ orderId }, 'https://evil.example.test'))).status).toBe(403);
    expect((await POST(request({ orderId: 'bad' }))).status).toBe(400);
    expect((await POST(request({ orderId, amount: 1 }))).status).toBe(400);
    mocks.userId = null;
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes the authenticated user ID, not a browser-supplied identity or amount', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('clear_paid_order_cart', { p_user_id: mocks.userId, p_order_id: orderId });
  });
  it('returns the same response for replay and never exposes other member orders', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'unchanged', clearedLines: 0 }, error: null })
      .mockResolvedValueOnce({ data: { status: 'not_found' }, error: null });
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(404);
  });
  it('preserves later checkouts and fails closed on database errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'later_order' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'db' } });
    expect((await (await POST(request())).json()).data.status).toBe('later_order');
    expect((await POST(request())).status).toBe(503);
  });
});
