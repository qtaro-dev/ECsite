import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });

import {
  buildStripeCheckoutSessionParams,
  createStripeCheckoutGateway,
  requireStripeTestSecretKey,
  sessionExpiryEpochSeconds,
  StripeCheckoutError,
} from '../../src/server/checkout/stripe-checkout';

const now = Math.floor(Date.now() / 1000) * 1000;
const input = {
  orderId: '0be4eb7c-29d5-4e8e-aa39-774675428101',
  attemptId: '3edaa952-e1a3-4548-b90e-3f6972a9ec8e',
  amountYen: 10939,
  allocationExpiresAt: new Date(now + 35 * 60_000).toISOString(),
  siteOrigin: 'https://shop.example.test',
};

afterEach(() => vi.useRealTimers());

describe('Stripe Checkout test gateway', () => {
  it('accepts only sk_test keys and rejects live or missing keys', () => {
    expect(requireStripeTestSecretKey('sk_test_123')).toBe('sk_test_123');
    for (const key of ['sk_live_123', undefined, 'pk_test_123']) {
      expect(() => requireStripeTestSecretKey(key)).toThrow(StripeCheckoutError);
    }
  });

  it('creates a single JPY amount for the locked order, minimal metadata, and a fixed safe return origin', () => {
    const params = buildStripeCheckoutSessionParams(input, now);
    expect(params).toMatchObject({
      mode: 'payment', currency: 'jpy', locale: 'ja', submit_type: 'pay',
      line_items: [{ price_data: { currency: 'jpy', unit_amount: 10939 }, quantity: 1 }],
      metadata: { order_id: input.orderId, attempt_id: input.attemptId },
      payment_intent_data: { metadata: { order_id: input.orderId, attempt_id: input.attemptId } },
      expires_at: now / 1000 + 1810,
      success_url: `https://shop.example.test/checkout/status?orderId=${input.orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://shop.example.test/checkout/review?orderId=${input.orderId}&payment=cancelled`,
    });
    expect(JSON.stringify(params)).not.toMatch(/recipientName|postalCode|email|street/i);
    expect(() => buildStripeCheckoutSessionParams({ ...input, siteOrigin: 'https://attacker.test/path' }, now)).toThrow(StripeCheckoutError);
  });

  it('aborts before Stripe if the 5-minute setup window cannot fit a 30-minute Session inside the 35-minute stock hold', () => {
    const expiry = new Date(now + 35 * 60_000).toISOString();
    expect(sessionExpiryEpochSeconds(expiry, now + 4 * 60_000 + 50_000)).toBe(now / 1000 + 35 * 60);
    expect(() => sessionExpiryEpochSeconds(expiry, now + 4 * 60_000 + 51_000)).toThrowError(
      expect.objectContaining({ code: 'ALLOCATION_WINDOW_ELAPSED', kind: 'definitive_failure' }),
    );
  });

  it('passes the stable idempotency key to the official SDK adapter and validates test Session response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      livemode: false, created: now / 1000, expires_at: now / 1000 + 1810,
    });
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    const session = await gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ line_items: [{
      price_data: expect.objectContaining({ unit_amount: 10939 }), quantity: 1,
    }] }), { idempotencyKey: '2f8c342f-18f2-4f50-b0f3-832c7ca9547c' });
    expect(session).toEqual({ id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123', createdAtEpochSeconds: now / 1000, expiresAtEpochSeconds: now / 1000 + 1810 });
  });

  it('distinguishes definite SDK 4xx from ambiguous network/5xx failures', async () => {
    const create = vi.fn();
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    create.mockRejectedValueOnce(Object.assign(new Error('declined request'), { statusCode: 400 }));
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'definitive_failure' });
    create.mockRejectedValueOnce(new Error('socket timeout'));
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'uncertain' });
    create.mockRejectedValueOnce(Object.assign(new Error('server error'), { statusCode: 500 }));
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it.each([408, 409, 429])('treats SDK HTTP %i as uncertain so the allocation is retained for idempotent recovery', async (statusCode) => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('ambiguous request result'), { statusCode }));
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it('rejects a Stripe-incompatible sub-50-yen total before calling the SDK', async () => {
    const create = vi.fn();
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    await expect(gateway.createSession({ ...input, amountYen: 49 }, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'definitive_failure' });
    expect(create).not.toHaveBeenCalled();
  });

  it('never accepts an invalid or live Checkout Session response as usable', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_live_abc', url: 'https://checkout.stripe.com/c/pay/cs_live_abc', livemode: true, created: 100, expires_at: 100 });
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'uncertain' });
  });

  it('expires a created Session and only reports a definite failure when the remaining allocation cannot cover 30 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      livemode: false, created: now / 1000 + 5 * 60, expires_at: now / 1000 + 1810,
    });
    const expire = vi.fn().mockResolvedValue({ id: 'cs_test_abc123', status: 'expired' });
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire } } });
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'definitive_failure', code: 'ALLOCATION_WINDOW_ELAPSED' });
    expect(expire).toHaveBeenCalledWith('cs_test_abc123');
  });

  it('keeps the result uncertain and must not release inventory if expiring a late Session fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      livemode: false, created: now / 1000 + 5 * 60, expires_at: now / 1000 + 1810,
    });
    const expire = vi.fn().mockRejectedValue(new Error('expire failed'));
    const gateway = createStripeCheckoutGateway({ checkout: { sessions: { create, expire } } });
    await expect(gateway.createSession(input, '2f8c342f-18f2-4f50-b0f3-832c7ca9547c'))
      .rejects.toMatchObject({ kind: 'uncertain', code: 'RESPONSE_UNCERTAIN' });
  });
});
