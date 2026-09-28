import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), readStatus: vi.fn(), userId: '00000000-0000-4000-8000-000000000001' as string | null }));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock('../../src/server/orders/order-read', () => ({ readOwnedOrderStatus: mocks.readStatus }));

import { NextRequest } from 'next/server';
import { GET } from '../../src/app/api/checkout/status/route';

const orderId = '00000000-0000-4000-8000-000000000002';
function request(query = `orderId=${orderId}`) { return new NextRequest(`http://localhost:3000/api/checkout/status?${query}`); }

describe('GET /api/checkout/status', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.userId = '00000000-0000-4000-8000-000000000001';
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: mocks.userId ? { id: mocks.userId } : null }, error: null })) } });
    mocks.readStatus.mockResolvedValue({ status: 'payment_pending' });
  });
  it('rejects malformed and duplicate order IDs before database access', async () => {
    expect((await GET(request('orderId=bad'))).status).toBe(400);
    expect((await GET(request(`orderId=${orderId}&orderId=${orderId}`))).status).toBe(400);
    expect(mocks.readStatus).not.toHaveBeenCalled();
  });
  it('requires an authenticated member', async () => {
    mocks.userId = null;
    expect((await GET(request())).status).toBe(401);
    expect(mocks.readStatus).not.toHaveBeenCalled();
  });
  it('reads only the current owner and treats missing or other-member ID as 404', async () => {
    mocks.readStatus.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(404);
    expect(mocks.readStatus).toHaveBeenCalledWith(expect.anything(), '00000000-0000-4000-8000-000000000001', orderId);
  });
  it.each([
    ['payment_pending', false], ['paid', false], ['payment_failed', true], ['expired', true], ['review_required', false],
  ])('reports database %s without trusting Stripe return query', async (state, retryEligible) => {
    mocks.readStatus.mockResolvedValue({ status: state });
    const response = await GET(request(`orderId=${orderId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).data).toMatchObject({ status: state, retryEligible });
  });
  it('fails closed on invalid database state or data source error', async () => {
    mocks.readStatus.mockResolvedValueOnce({ status: 'unknown' }).mockRejectedValueOnce(new Error('db'));
    expect((await GET(request())).status).toBe(503);
    expect((await GET(request())).status).toBe(503);
  });
});
