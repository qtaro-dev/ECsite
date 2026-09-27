import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn(), getCart: vi.fn(),
  loadCheckoutQuoteSource: vi.fn(), calculateCheckoutQuote: vi.fn(), buildCheckoutOrderSnapshot: vi.fn(),
  allocateCheckoutOrder: vi.fn(), getStripeCheckoutGateway: vi.fn(),
  authUser: { id: 'member-1' as string | null }, replayOrder: null as unknown,
  quoteRow: null as unknown, pendingAttempt: null as unknown,
}));

// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/cart/cart-api', () => ({ getCart: mocks.getCart, CartApiError: class CartApiError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../../src/server/checkout/quote-source', () => ({ loadCheckoutQuoteSource: mocks.loadCheckoutQuoteSource, CheckoutQuoteSourceError: class CheckoutQuoteSourceError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../../src/server/checkout/quote-calculation', () => ({ calculateCheckoutQuote: mocks.calculateCheckoutQuote }));
vi.mock('../../src/server/checkout/order-allocation', () => ({
  buildCheckoutOrderSnapshot: mocks.buildCheckoutOrderSnapshot,
  allocateCheckoutOrder: mocks.allocateCheckoutOrder,
  CheckoutAllocationError: class CheckoutAllocationError extends Error { constructor(readonly code: string) { super(code); } },
}));
vi.mock('../../src/server/checkout/stripe-client', () => ({ getStripeCheckoutGateway: mocks.getStripeCheckoutGateway }));

import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/checkout/start/route';
import { StripeCheckoutError } from '../../src/server/checkout/stripe-checkout';

const userId = '00000000-0000-4000-8000-000000000001';
const quoteId = '00000000-0000-4000-8000-000000000002';
const orderId = '00000000-0000-4000-8000-000000000003';
const attemptId = '00000000-0000-4000-8000-000000000004';
const checkoutKey = '00000000-0000-4000-8000-000000000005';
const grandTotalYen = 10939;
const quoteRow = {
  id: quoteId, user_id: userId, address_id: '00000000-0000-4000-8000-000000000006',
  items_snapshot: [], goods_total_yen: 9999, shipping_base_yen: 940, shipping_heavy_yen: 0,
  tax_total_yen: 994, grand_total_yen: grandTotalYen, shipping_settings_version: 'v3',
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
};
const snapshot = {
  address: {}, items: [], goodsTotalYen: 9999, shipping: { baseYen: 940, heavyYen: 0, totalYen: 940 },
  taxTotalYen: 994, grandTotalYen, shippingSettingsVersion: 'v3', compatibility: [],
};
const quote = { grandTotalYen };
const cart = { items: [{ productId: 'product-1', quantity: 1 }] };

function request() {
  return new NextRequest('http://localhost:3000/api/checkout/start', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'idempotency-key': checkoutKey },
    body: JSON.stringify({ quoteId, userConfirmed: true }),
  });
}

function queryClient() {
  return {
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => { filters[column] = value; return query; }),
        maybeSingle: vi.fn(async () => {
          if (table === 'orders' && filters.checkout_key) return { data: mocks.replayOrder, error: null };
          if (table === 'orders' && filters.id) return { data: { id: orderId, user_id: userId, checkout_key: checkoutKey, checkout_quote_id: quoteId, status: 'payment_pending', grand_total_yen: grandTotalYen }, error: null };
          if (table === 'payment_attempts') return { data: mocks.pendingAttempt, error: null };
          if (table === 'checkout_quotes') return { data: mocks.quoteRow, error: null };
          return { data: null, error: null };
        }),
      };
      return query;
    }),
    rpc: vi.fn(async (name: string) => name === 'checkout_session_prepare'
      ? { data: { status: 'prepared', expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 1810, siteOrigin: 'http://localhost:3000' }, error: null }
      : name === 'checkout_session_record'
        ? { data: { status: 'stored' }, error: null }
        : { data: { status: 'released' }, error: null }),
  };
}

describe('POST /api/checkout/start', () => {
  let serviceClient: ReturnType<typeof queryClient>;
  let createSession: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser.id = userId;
    mocks.replayOrder = null;
    mocks.quoteRow = { ...quoteRow, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() };
    mocks.pendingAttempt = { id: attemptId, state: 'created', amount_yen: grandTotalYen, expires_at: new Date(Date.now() + 35 * 60_000).toISOString() };
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: mocks.authUser.id ? { id: mocks.authUser.id } : null }, error: null })) } });
    mocks.getCart.mockResolvedValue(cart);
    mocks.loadCheckoutQuoteSource.mockResolvedValue({ products: [] });
    mocks.calculateCheckoutQuote.mockReturnValue({ ok: true, quote });
    mocks.buildCheckoutOrderSnapshot.mockReturnValue(snapshot);
    mocks.allocateCheckoutOrder.mockResolvedValue({ status: 'created', orderId, attemptId, amountYen: grandTotalYen, expiresAt: new Date(Date.now() + 35 * 60_000).toISOString(), checkoutKey });
    createSession = vi.fn().mockResolvedValue({ id: 'cs_test_example', url: 'https://checkout.stripe.com/c/pay/cs_test_example' });
    mocks.getStripeCheckoutGateway.mockResolvedValue({ createSession });
    serviceClient = queryClient();
    mocks.createCartServiceClient.mockReturnValue(serviceClient);
  });

  it('requires a signed-in member before creating orders or calling Stripe', async () => {
    mocks.authUser.id = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.allocateCheckoutOrder).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns a re-quote conflict when the atomic allocation detects changed pricing', async () => {
    mocks.allocateCheckoutOrder.mockResolvedValueOnce({ status: 'quote_changed', changedFields: ['price'], differences: [{ field: 'price' }], quotedTotals: {}, currentTotals: {}, nextAction: 'create_new_quote' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'QUOTE_CHANGED', nextAction: 'create_new_quote' } });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('recovers a pending order with the same key after its saved quote has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T03:20:00.000Z'));
    mocks.replayOrder = { id: orderId, user_id: userId, checkout_key: checkoutKey, checkout_quote_id: quoteId, status: 'payment_pending', grand_total_yen: grandTotalYen };
    mocks.quoteRow = { ...quoteRow, expires_at: '2026-09-26T03:15:00.000Z' };
    mocks.pendingAttempt = { id: attemptId, state: 'created', amount_yen: grandTotalYen, expires_at: '2026-09-26T03:35:00.000Z' };
    try {
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { orderId, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_example' } });
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ amountYen: grandTotalYen }), checkoutKey);
      expect(mocks.allocateCheckoutOrder).not.toHaveBeenCalled();
      expect(mocks.getCart).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('retains the allocation on an uncertain Stripe response and compensates only a definitive rejection', async () => {
    createSession.mockRejectedValueOnce(new StripeCheckoutError('uncertain', 'RESPONSE_UNCERTAIN'));
    expect((await POST(request())).status).toBe(503);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1);
    expect(serviceClient.rpc).toHaveBeenCalledWith('checkout_session_prepare', expect.any(Object));

    createSession.mockRejectedValueOnce(new StripeCheckoutError('definitive_failure', 'STRIPE_FAILURE'));
    expect((await POST(request())).status).toBe(503);
    expect(serviceClient.rpc).toHaveBeenCalledWith('checkout_session_creation_failed', expect.objectContaining({ p_order_id: orderId, p_attempt_id: attemptId }));
  });

  it('keeps the result ambiguous when recording the Stripe Session id has an unknown DB outcome', async () => {
    serviceClient.rpc.mockImplementation((async (name: string) => name === 'checkout_session_record'
      ? { data: null, error: { message: 'connection lost' } }
      : name === 'checkout_session_prepare'
        ? { data: { status: 'prepared', expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 1810, siteOrigin: 'http://localhost:3000' }, error: null }
        : { data: { status: 'released' }, error: null }) as never);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(serviceClient.rpc).toHaveBeenCalledTimes(2);
    expect(serviceClient.rpc).toHaveBeenCalledWith('checkout_session_record', expect.objectContaining({ p_session_id: 'cs_test_example' }));
  });

  it('does not return a Session URL after its frozen Stripe expiry', async () => {
    serviceClient.rpc.mockResolvedValueOnce({ data: { status: 'session_expired' }, error: null } as never);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'QUOTE_EXPIRED' } });
    expect(createSession).not.toHaveBeenCalled();
  });
});
