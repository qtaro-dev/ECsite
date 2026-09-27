import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });

import { startStripeSession } from '../../src/server/checkout/start-stripe-session';
import { createStripeCheckoutGateway } from '../../src/server/checkout/stripe-checkout';

const baseTime = Date.parse('2026-09-26T03:00:00.000Z');
const orderId = '0be4eb7c-29d5-4e8e-aa39-774675428101';
const attemptId = '3edaa952-e1a3-4548-b90e-3f6972a9ec8e';
const idempotencyKey = '2f8c342f-18f2-4f50-b0f3-832c7ca9547c';

afterEach(() => vi.useRealTimers());

describe('startStripeSession retry parameters', () => {
  it('reuses the first absolute expiry and origin when the same operation retries later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    const preparedExpiry = baseTime / 1000 + 1810;
    const create = vi.fn().mockResolvedValue({
      id: 'cs_test_abc123', url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      livemode: false, status: 'open', created: baseTime / 1000, expires_at: preparedExpiry,
    });
    const stripe = createStripeCheckoutGateway({ checkout: { sessions: { create, expire: vi.fn() } } });
    let prepareCount = 0;
    let recordCount = 0;
    const serviceClient = { rpc: vi.fn(async (name: string) => {
      if (name === 'checkout_session_prepare') {
        prepareCount += 1;
        return { data: {
          status: prepareCount === 1 ? 'prepared' : 'already_prepared',
          expiresAtEpochSeconds: preparedExpiry,
          siteOrigin: 'https://shop.example.test',
        }, error: null };
      }
      recordCount += 1;
      return { data: { status: recordCount === 1 ? 'stored' : 'already_stored' }, error: null };
    }) } as never;
    const input = {
      stripe, serviceClient, orderId, attemptId, amountYen: 10939,
      allocationExpiresAt: new Date(baseTime + 35 * 60_000).toISOString(),
      idempotencyKey, siteOrigin: 'https://shop.example.test',
    };

    expect((await startStripeSession(input)).ok).toBe(true);
    vi.setSystemTime(baseTime + 90_000);
    expect((await startStripeSession(input)).ok).toBe(true);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(create.mock.calls[0][0].expires_at).toBe(preparedExpiry);
    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey });
  });
});
