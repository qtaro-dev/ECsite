import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/checkout/stripe-reconciliation', () => ({ getReconciliationStripeClient: vi.fn() }));

import { processDemoDeletion } from '../../src/server/account/demo-retention';

const userId = '00000000-0000-4000-8000-000000000522';
const orderId = '00000000-0000-4000-8000-000000000523';
const attemptId = '00000000-0000-4000-8000-000000000524';
const amountYen = 100;

function fixture(orders: Array<{ id: string; status: string }> = [], attempts: Array<Record<string, unknown>> = []) {
  const rpc = vi.fn(async (name: string) => ({ data: name === 'finish_demo_retention' ? 'deleted' : null, error: null }));
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => Promise.resolve({ data: table === 'orders' ? orders : [], error: null }),
      in: () => Promise.resolve({ data: table === 'payment_attempts' ? attempts : [], error: null }),
    }),
  }));
  const client = { auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: userId, is_anonymous: true } }, error: null })) } }, from, rpc };
  return { client, rpc, from };
}

function paymentIntent(overrides: Record<string, unknown> = {}) {
  return { id: 'pi_demo', livemode: false, status: 'succeeded', amount_received: amountYen, currency: 'jpy',
    metadata: { order_id: orderId, attempt_id: attemptId }, ...overrides };
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return { id: 'cs_test_valid', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
    amount_total: amountYen, currency: 'jpy', customer: 'cus_demo', payment_intent: paymentIntent(),
    metadata: { order_id: orderId, attempt_id: attemptId }, ...overrides };
}

function stripeClient(session: Record<string, unknown>) {
  const retrieve = vi.fn(async () => session);
  const del = vi.fn().mockResolvedValue({ deleted: true });
  const retrieveIntent = vi.fn(async () => paymentIntent());
  return { client: { checkout: { sessions: { retrieve } }, customers: { del }, paymentIntents: { retrieve: retrieveIntent } }, retrieve, del, retrieveIntent };
}

function attempt(state: string) {
  return { id: attemptId, order_id: orderId, state, stripe_session_id: 'cs_test_valid', amount_yen: amountYen };
}

describe('demo retention worker', () => {
  it('deletes an empty anonymous demo account through the guarded DB RPC', async () => {
    const { client, rpc } = fixture();
    expect(await processDemoDeletion({ client: client as never, userId })).toBe('deleted');
    expect(rpc).toHaveBeenCalledWith('finish_demo_retention', { p_user_id: userId });
    expect(rpc).not.toHaveBeenCalledWith('defer_demo_retention', expect.anything());
  });

  it('retains pending payment data and records a retry reason', async () => {
    const { client, rpc } = fixture([{ id: orderId, status: 'payment_pending' }]);
    expect(await processDemoDeletion({ client: client as never, userId })).toBe('deferred');
    expect(rpc).toHaveBeenCalledWith('defer_demo_retention', { p_user_id: userId, p_code: 'payment_pending' });
    expect(rpc).not.toHaveBeenCalledWith('finish_demo_retention', expect.anything());
  });

  it('deletes only a verified test Customer after terminal payment and retries transient failure', async () => {
    const { client, rpc } = fixture([{ id: orderId, status: 'paid' }], [attempt('succeeded')]);
    const { client: stripe, del } = stripeClient(checkoutSession());
    del.mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ deleted: true });
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deferred');
    expect(rpc).toHaveBeenCalledWith('defer_demo_retention', { p_user_id: userId, p_code: 'stripe_unavailable' });
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deleted');
    expect(del).toHaveBeenCalledWith('cus_demo');
    expect(rpc).toHaveBeenCalledWith('finish_demo_retention', { p_user_id: userId });
  });

  it('never deletes a Customer when Stripe reports live mode or mismatched ownership', async () => {
    const { client, rpc } = fixture([{ id: orderId, status: 'paid' }], [attempt('succeeded')]);
    const { client: stripe, del } = stripeClient(checkoutSession({ livemode: true }));
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deferred');
    expect(del).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('finish_demo_retention', expect.anything());
  });

  it('deletes a test Customer for a T31 async payment failure in complete/unpaid state', async () => {
    const { client, rpc } = fixture([{ id: orderId, status: 'payment_failed' }], [attempt('failed')]);
    const { client: stripe, del } = stripeClient(checkoutSession({ payment_status: 'unpaid',
      payment_intent: paymentIntent({ status: 'requires_payment_method', amount_received: 0 }) }));
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deleted');
    expect(del).toHaveBeenCalledWith('cus_demo');
    expect(rpc).toHaveBeenCalledWith('finish_demo_retention', { p_user_id: userId });
  });

  it('defers async failure while its PaymentIntent is actionable or has received funds', async () => {
    const { client, rpc } = fixture([{ id: orderId, status: 'payment_failed' }], [attempt('failed')]);
    const { client: stripe, del, retrieve } = stripeClient(checkoutSession({ payment_status: 'unpaid',
      payment_intent: paymentIntent({ status: 'requires_action', amount_received: 0 }) }));
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deferred');
    expect(del).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('defer_demo_retention', { p_user_id: userId, p_code: 'payment_pending' });
    retrieve.mockResolvedValue(checkoutSession({ payment_status: 'unpaid',
      payment_intent: paymentIntent({ status: 'requires_payment_method', amount_received: 1 }) }));
    expect(await processDemoDeletion({ client: client as never, userId, stripe: stripe as never })).toBe('deferred');
    expect(del).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('finish_demo_retention', expect.anything());
  });
});
