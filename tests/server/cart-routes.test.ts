import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class CartApiError extends Error { constructor(readonly code: string) { super(code); } }
  return { CartApiError, getUser: vi.fn(), getCart: vi.fn(), putCartItem: vi.fn(), removeCartItem: vi.fn(), mergeCart: vi.fn(), createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn() };
});
const { getCart, putCartItem, removeCartItem, mergeCart, createSupabaseServerClient, createCartServiceClient } = mocks;
// @ts-expect-error Vitest resolves Next's server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/cart/cart-api', () => ({
  CartApiError: mocks.CartApiError,
  getCart: mocks.getCart, putCartItem: mocks.putCartItem, removeCartItem: mocks.removeCartItem, mergeCart: mocks.mergeCart,
}));

import { GET, PUT } from '../../src/app/api/cart/route';
import { POST as merge } from '../../src/app/api/cart/merge/route';
import { createAnonymousCartCookieValue, anonymousCartTokenHash } from '../../src/server/cart/anonymous-cookie';
import { NextRequest } from 'next/server';

const projection = { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 };
const UUID = '00000000-0000-4000-8000-000000000001';

function request(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(`http://localhost:3000/api${path}`, init);
}

describe('cart routes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('ANON_CART_SIGNING_KEY', 't25-test-signing-key-which-is-longer-than-32-bytes');
    vi.stubEnv('NODE_ENV', 'development');
    vi.clearAllMocks();
    const noSession = new Error('Auth session missing!');
    noSession.name = 'AuthSessionMissingError';
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: noSession });
    createSupabaseServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    createCartServiceClient.mockReturnValue({ role: 'service_role' });
    getCart.mockResolvedValue(projection);
    putCartItem.mockResolvedValue(projection);
  });

  it('issues a signed HttpOnly cookie without returning the owner hash or token in JSON', async () => {
    const response = await GET(request('/cart'));
    const body = await response.text();
    const cookie = response.headers.get('set-cookie') ?? '';
    const value = cookie.match(/ec_cart=([^;]+)/)?.[1];
    expect(response.status).toBe(200);
    expect(cookie).toContain('HttpOnly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(value).toBeTruthy();
    expect(body).not.toContain(value);
    expect(body).not.toContain(anonymousCartTokenHash(value));
    expect(body).toContain('"estimatedShippingYen":0');
    expect(createCartServiceClient).toHaveBeenCalledOnce();
  });

  it('keeps Auth transport failures as 503 instead of treating them as anonymous', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Auth service unavailable') });
    const response = await GET(request('/cart'));
    expect(response.status).toBe(503);
    expect(getCart).not.toHaveBeenCalled();
  });

  it('rejects tampered cookies and invalid quantities before a database mutation', async () => {
    const signed = createAnonymousCartCookieValue();
    const tampered = await GET(request('/cart', { headers: { cookie: `ec_cart=${signed}x` } }));
    expect(tampered.status).toBe(400);
    const invalid = await PUT(request('/cart', { method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ productId: UUID, quantity: 11 }) }));
    expect(invalid.status).toBe(400);
    expect(putCartItem).not.toHaveBeenCalled();
  });

  it('returns the latest server cart on a stock conflict without exposing cookie credentials', async () => {
    putCartItem.mockRejectedValueOnce(new mocks.CartApiError('CONFLICT'));
    const currentCart = { items: [{ productId: UUID, quantity: 1, unitPriceYen: 1500, lineTotalYen: 1500, availableQuantity: 1 }], goodsTotalYen: 1500, estimatedShippingYen: 940 };
    getCart.mockResolvedValueOnce(currentCart);
    const response = await PUT(request('/cart', {
      method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ productId: UUID, quantity: 2 }),
    }));
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(JSON.parse(text).error.currentCart).toEqual(currentCart);
    expect(text).not.toContain('ec_cart');
    expect(text).not.toContain(anonymousCartTokenHash((response.headers.get('set-cookie') ?? '').match(/ec_cart=([^;]+)/)?.[1]));
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('requires a signed cookie for an anonymous cart merge and rejects unauthenticated callers', async () => {
    const response = await merge(request('/cart/merge', { method: 'POST', headers: { origin: 'http://localhost:3000' } }));
    expect(response.status).toBe(401);
    expect(mergeCart).not.toHaveBeenCalled();
  });

  it('keeps member cart reads on the member SSR client instead of service role', async () => {
    const memberClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'member-1' } }, error: null }) } };
    createSupabaseServerClient.mockResolvedValueOnce(memberClient);
    await GET(request('/cart'));
    expect(getCart).toHaveBeenCalledWith(memberClient, null);
    expect(createCartServiceClient).not.toHaveBeenCalled();
  });
});
