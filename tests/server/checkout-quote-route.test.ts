import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn(), getCart: vi.fn(),
  loadCheckoutQuoteSource: vi.fn(), calculateCheckoutQuote: vi.fn(),
}));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/cart/cart-api', () => ({ getCart: mocks.getCart, CartApiError: class CartApiError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../../src/server/checkout/quote-source', () => ({ loadCheckoutQuoteSource: mocks.loadCheckoutQuoteSource, CheckoutQuoteSourceError: class CheckoutQuoteSourceError extends Error { constructor(readonly code: string) { super(code); } } }));
vi.mock('../../src/server/checkout/quote-calculation', () => ({ calculateCheckoutQuote: mocks.calculateCheckoutQuote }));

import { POST } from '../../src/app/api/checkout/quote/route';
import { NextRequest } from 'next/server';

const user = { id: 'member-1' };
const addressId = '00000000-0000-4000-8000-000000000011';
const productId = '00000000-0000-4000-8000-000000000012';
const quote = {
  address: { id: addressId, recipientName: '受取人', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '千代田1-1', building: null, isDefault: true },
  items: [{ productId, sku: 'CPU-1', name: 'CPU', brand: 'Brand', category: 'cpu', quantity: 1, unitPriceYen: 9999, lineTotalYen: 9999, availableQuantity: 5, taxRateBasisPoints: 1000, unitPriceAtAddYen: 9000 }],
  priceChanges: [{ productId, name: 'CPU', unitPriceAtAddYen: 9000, unitPriceYen: 9999 }],
  goodsTotalYen: 9999, shipping: { baseYen: 940, heavyYen: 0, totalYen: 940 }, taxTotalYen: 994, grandTotalYen: 10939,
  shippingSettingsVersion: 'v3', shippingSourceUrl: 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',
  shippingSourceCheckedAt: '2026-09-25T00:00:00.000Z', compatibility: ['cpu_motherboard_socket', 'motherboard_memory_ddr', 'motherboard_case_form_factor', 'gpu_case_length', 'cpu_cooler_socket'].map((rule) => ({ rule, status: 'compatible', reason: 'ok', comparedValues: {}, matchingUrl: null })),
};
const cart = { items: [{ productId, quantity: 1, unitPriceYen: 9000, lineTotalYen: 9000, availableQuantity: 5 }], goodsTotalYen: 9000, estimatedShippingYen: 940 };
function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/checkout/quote', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('checkout quote route', () => {
  let insert: ReturnType<typeof vi.fn>;
  let deleteQuery: ReturnType<typeof vi.fn>;
  let rateLimit: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) } });
    mocks.getCart.mockResolvedValue(cart);
    mocks.loadCheckoutQuoteSource.mockResolvedValue({});
    mocks.calculateCheckoutQuote.mockReturnValue({ ok: true, quote });
    insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: '00000000-0000-4000-8000-000000000013' }, error: null }) }) });
    deleteQuery = vi.fn().mockReturnValue({ lt: vi.fn().mockResolvedValue({ error: null }) });
    rateLimit = vi.fn().mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    mocks.createCartServiceClient.mockReturnValue({ rpc: rateLimit, from: vi.fn(() => ({ delete: deleteQuery, insert })) });
  });

  it('uses member cart/auth, persists only the short-lived quote snapshot without address text, and returns latest prices', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T03:00:00.000Z'));
    try {
      const response = await POST(request({ addressId }));
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.data).toMatchObject({ quoteId: '00000000-0000-4000-8000-000000000013', expiresAt: '2026-09-26T03:15:00.000Z', grandTotalYen: 10939, priceChanges: quote.priceChanges });
      expect(mocks.getCart).toHaveBeenCalledWith(expect.anything(), null);
      expect(rateLimit).toHaveBeenCalledWith('checkout_quote_rate_limit', { p_user_id: user.id });
      const stored = insert.mock.calls[0][0];
      expect(stored).toMatchObject({ user_id: user.id, address_id: addressId, items_snapshot: [{ productId, quantity: 1, unitPriceYen: 9999, lineTotalYen: 9999 }], grand_total_yen: 10939, expires_at: '2026-09-26T03:15:00.000Z' });
      expect(Object.keys(stored)).not.toContain('address');
      expect(JSON.stringify(stored)).not.toContain('受取人');
      expect(deleteQuery).toHaveBeenCalledOnce();
      expect(payload.data.address.recipientName).toBe('受取人');
    } finally { vi.useRealTimers(); }
  });

  it('rejects stock shortages and unavailable formal shipping before persisting a quote', async () => {
    mocks.calculateCheckoutQuote.mockReturnValueOnce({ ok: false, failure: { kind: 'stock_unavailable', items: [{ productId, requestedQuantity: 1, availableQuantity: 0 }] } });
    expect((await POST(request({ addressId }))).status).toBe(409);
    mocks.calculateCheckoutQuote.mockReturnValueOnce({ ok: false, failure: { kind: 'shipping_unavailable', reason: 'rate_unavailable' } });
    expect((await POST(request({ addressId }))).status).toBe(503);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After before expensive cart and quote reads when the member limit is exceeded', async () => {
    rateLimit.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 17 }], error: null });
    const response = await POST(request({ addressId }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(mocks.getCart).not.toHaveBeenCalled();
    expect(mocks.loadCheckoutQuoteSource).not.toHaveBeenCalled();
  });
});
