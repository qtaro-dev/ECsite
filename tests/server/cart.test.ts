import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CartItemInputSchema } from '../../src/lib/schemas';
// @ts-expect-error Vitest resolves Next's server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
import { anonymousCartTokenHash, createAnonymousCartCookieValue } from '../../src/server/cart/anonymous-cookie';
import { getCart, mergeCart, putCartItem } from '../../src/server/cart/cart-api';

describe('anonymous cart cookie', () => {
  beforeEach(() => vi.stubEnv('ANON_CART_SIGNING_KEY', 't25-test-signing-key-which-is-longer-than-32-bytes'));

  it('signs a high entropy token and derives a stable opaque owner hash', () => {
    const cookie = createAnonymousCartCookieValue();
    expect(anonymousCartTokenHash(cookie)).toMatch(/^[0-9a-f]{64}$/);
    expect(anonymousCartTokenHash(cookie)).toBe(anonymousCartTokenHash(cookie));
    expect(cookie.split('.')[0]).toHaveLength(43);
  });

  it('rejects altered, malformed, or unsigned values', () => {
    const cookie = createAnonymousCartCookieValue();
    expect(anonymousCartTokenHash(`${cookie}x`)).toBeNull();
    expect(anonymousCartTokenHash('arbitrary')).toBeNull();
    vi.stubEnv('ANON_CART_SIGNING_KEY', 'a-different-signing-key-that-is-over-32-bytes');
    expect(anonymousCartTokenHash(cookie)).toBeNull();
  });
});

describe('cart RPC service', () => {
  const projection = { items: [], goodsTotalYen: 0, estimatedShippingYen: 0 };
  const rpc = vi.fn();
  const client = { rpc };
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: projection, error: null }); });

  it('accepts the quantity endpoints and rejects values outside 1–10', () => {
    const productId = '00000000-0000-4000-8000-000000000001';
    expect(CartItemInputSchema.safeParse({ productId, quantity: 1 }).success).toBe(true);
    expect(CartItemInputSchema.safeParse({ productId, quantity: 10 }).success).toBe(true);
    expect(CartItemInputSchema.safeParse({ productId, quantity: 0 }).success).toBe(false);
    expect(CartItemInputSchema.safeParse({ productId, quantity: 11 }).success).toBe(false);
  });

  it('reads an uncached server projection and passes only the owner hash', async () => {
    await expect(getCart(client, 'a'.repeat(64))).resolves.toEqual(projection);
    expect(rpc).toHaveBeenCalledWith('cart_get', { p_anonymous_token_hash: 'a'.repeat(64) });
  });

  it('sets quantity and maps stock races to a 409 domain error', async () => {
    await putCartItem(client, null, '00000000-0000-4000-8000-000000000001', 10);
    expect(rpc).toHaveBeenCalledWith('cart_put', expect.objectContaining({ p_quantity: 10 }));
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'cart stock conflict' } });
    await expect(putCartItem(client, null, '00000000-0000-4000-8000-000000000001', 2))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('validates merge adjustments and fails closed for malformed database output', async () => {
    rpc.mockResolvedValueOnce({ data: { cart: projection, adjustments: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 0 }] }, error: null });
    await expect(mergeCart(client, 'a'.repeat(64)).then(({ adjustments }) => adjustments[0].quantity)).resolves.toBe(0);
    rpc.mockResolvedValueOnce({ data: { items: [], goodsTotalYen: 0, estimatedShippingYen: 'unknown' }, error: null });
    await expect(getCart(client, null)).rejects.toThrow();
    rpc.mockResolvedValueOnce({ data: { ...projection, estimatedShippingYen: null }, error: null });
    await expect(getCart(client, null)).resolves.toMatchObject({ estimatedShippingYen: null });
  });
});
