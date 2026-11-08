import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn(), getCart: vi.fn(),
  loadCheckoutQuoteSource: vi.fn(), calculateCheckoutQuote: vi.fn(), buildCheckoutOrderSnapshot: vi.fn(),
  user: { id: 'demo-user', isDemo: true }, quote: { id: 'quote-id', address_id: 'address-id',
    expires_at: new Date(Date.now() + 60_000).toISOString(), demo_completed_at: null as string | null },
  rpcResult: { status: 'completed' as string } as { status: string; productId?: string; availableQuantity?: number },
}));

// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/cart/cart-api', () => ({ getCart: mocks.getCart, CartApiError: class CartApiError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../../src/server/checkout/quote-source', () => ({
  loadCheckoutQuoteSource: mocks.loadCheckoutQuoteSource,
  CheckoutQuoteSourceError: class CheckoutQuoteSourceError extends Error { constructor(readonly code: string) { super(code); } },
}));
vi.mock('../../src/server/checkout/quote-calculation', () => ({ calculateCheckoutQuote: mocks.calculateCheckoutQuote }));
vi.mock('../../src/server/checkout/order-allocation', () => ({
  buildCheckoutOrderSnapshot: mocks.buildCheckoutOrderSnapshot,
  CheckoutAllocationError: class CheckoutAllocationError extends Error { constructor(readonly code: string) { super(code); } },
}));

import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/checkout/demo-complete/route';

function request(body: unknown = { quoteId: '00000000-0000-4000-8000-000000000001', userConfirmed: true }) {
  return new NextRequest('http://localhost:3000/api/checkout/demo-complete', {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

function client() {
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: mocks.quote, error: null })),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: mocks.rpcResult, error: null })),
  };
}

describe('POST /api/checkout/demo-complete', () => {
  let serviceClient: ReturnType<typeof client>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.id = 'demo-user'; mocks.user.isDemo = true;
    mocks.quote = { id: '00000000-0000-4000-8000-000000000001', address_id: 'address-id',
      expires_at: new Date(Date.now() + 60_000).toISOString(), demo_completed_at: null };
    mocks.rpcResult = { status: 'completed' };
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({
      data: { user: mocks.user.id ? { id: mocks.user.id, is_anonymous: mocks.user.isDemo } : null }, error: null,
    })) } });
    mocks.getCart.mockResolvedValue({ items: [{ productId: '00000000-0000-4000-8000-000000000010', quantity: 1 }] });
    mocks.loadCheckoutQuoteSource.mockResolvedValue({ address: {
      id: 'address-id', recipientName: 'デモ購入者', postalCode: '0000000', prefectureCode: 13,
      city: '架空市', street: 'デモ専用1番地', building: null, isDefault: false,
    }, products: [], availableByProductId: new Map(), settings: {} });
    mocks.calculateCheckoutQuote.mockReturnValue({ ok: true, quote: { items: [] } });
    mocks.buildCheckoutOrderSnapshot.mockReturnValue({ items: [] });
    serviceClient = client();
    mocks.createCartServiceClient.mockReturnValue(serviceClient);
  });

  it('refuses non-demo members before reading or mutating a quote', async () => {
    mocks.user.isDemo = false;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });

  it('replays a completed quote without reading or clearing a later cart', async () => {
    mocks.quote.demo_completed_at = new Date().toISOString();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { completed: true, replayed: true } });
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });

  it('sends a fresh server snapshot to the atomic RPC and returns its completion result', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { completed: true, replayed: false } });
    expect(serviceClient.rpc).toHaveBeenCalledWith('complete_demo_checkout', expect.objectContaining({
      p_user_id: 'demo-user', p_quote_id: mocks.quote.id, p_current_snapshot: { items: [] },
    }));
  });

  it('returns a conflict when atomic revalidation detects changed stock', async () => {
    mocks.rpcResult = { status: 'stock_unavailable', productId: '00000000-0000-4000-8000-000000000010', availableQuantity: 0 };
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain('在庫が不足');
  });

  it('rejects a malformed body before accessing any data', async () => {
    const response = await POST(request({ quoteId: 'bad', userConfirmed: false }));
    expect(response.status).toBe(400);
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(serviceClient.rpc).not.toHaveBeenCalled();
  });
});
