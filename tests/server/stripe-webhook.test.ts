import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
import { processStripeWebhook, type StripeWebhookSdk } from '@/server/checkout/stripe-webhook';

const secret = 'whsec_local_t31_signing_secret';
const orderId = '00000000-0000-4000-8000-000000000311';
const attemptId = '00000000-0000-4000-8000-000000000312';
const sessionId = 'cs_test_t31_session';
const paymentIntentId = 'pi_t31_intent';
const rawEvent = (type: string, id = 'evt_t31_event') => Buffer.from(JSON.stringify({
  id, object: 'event', api_version: '2025-09-30.clover', created: 1_800_000_000,
  data: { object: { id: sessionId, object: 'checkout.session' } }, livemode: false,
  pending_webhooks: 1, request: { id: null, idempotency_key: null }, type,
}));
function signature(payload: Buffer, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: sessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete',
    payment_status: 'paid', amount_total: 100, currency: 'jpy', created: 1_800_000_000,
    expires_at: 1_800_001_810, payment_intent: paymentIntentId, metadata: { order_id: orderId, attempt_id: attemptId },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function makeIntent(overrides: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: paymentIntentId, object: 'payment_intent', status: 'succeeded', amount: 100, amount_received: 100,
    currency: 'jpy', metadata: { order_id: orderId, attempt_id: attemptId },
    ...overrides,
  } as Stripe.PaymentIntent;
}

describe('processStripeWebhook', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let retrieveSession: ReturnType<typeof vi.fn>;
  let retrieveIntent: ReturnType<typeof vi.fn>;
  let sdk: StripeWebhookSdk;
  const serviceClient = {} as Parameters<typeof processStripeWebhook>[0]['serviceClient'];

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: { status: 'processed' }, error: null });
    retrieveSession = vi.fn().mockResolvedValue(makeSession({ payment_intent: makeIntent() }));
    retrieveIntent = vi.fn().mockResolvedValue(makeIntent());
    const verifier = new Stripe('sk_test_t31_unit_test_key');
    sdk = {
      webhooks: verifier.webhooks,
      checkout: { sessions: { retrieve: retrieveSession } },
      paymentIntents: { retrieve: retrieveIntent },
    } as unknown as StripeWebhookSdk;
    (serviceClient as unknown as { rpc: typeof rpc }).rpc = rpc;
  });

  it('verifies the exact raw bytes and applies current Session/PaymentIntent facts', async () => {
    const raw = rawEvent('checkout.session.completed');
    await expect(processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .resolves.toBe('processed');
    expect(retrieveSession).toHaveBeenCalledWith(sessionId, { expand: ['payment_intent'] });
    const [, params] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ p_result: 'succeeded', p_order_id: orderId, p_attempt_id: attemptId,
      p_session_amount_yen: 100, p_session_currency: 'jpy', p_payment_intent_id: paymentIntentId,
      p_payment_intent_amount_received: 100, p_livemode: false });
  });

  it('rejects a changed raw body before retrieving Stripe state or writing an event', async () => {
    const raw = rawEvent('checkout.session.completed');
    const changed = Buffer.from(`${raw.toString()} `);
    await expect(processStripeWebhook({ rawBody: changed, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .resolves.toBe('invalid_signature');
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the current successful Stripe state when an older expiry event arrives late', async () => {
    const raw = rawEvent('checkout.session.expired', 'evt_t31_old_expiry');
    retrieveSession.mockResolvedValue(makeSession({ payment_intent: makeIntent() }));
    await processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_result).toBe('succeeded');
  });

  it('uses the latest expired Session when an old completion event arrives late', async () => {
    const raw = rawEvent('checkout.session.completed', 'evt_t31_old_completion');
    retrieveSession.mockResolvedValue(makeSession({ status: 'expired', payment_status: 'unpaid', payment_intent: null }));
    await processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_result).toBe('expired');
  });

  it('does not release an expired Session while its PaymentIntent is still processing', async () => {
    const raw = rawEvent('checkout.session.expired', 'evt_t31_pending_intent');
    retrieveSession.mockResolvedValue(makeSession({ status: 'expired', payment_status: 'unpaid', payment_intent: makeIntent({ status: 'processing' }) }));
    await processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_result).toBe('pending');
  });

  it('classifies a verified asynchronous failure from the current failed PaymentIntent', async () => {
    const raw = rawEvent('checkout.session.async_payment_failed', 'evt_t31_async_failure');
    retrieveSession.mockResolvedValue(makeSession({ status: 'complete', payment_status: 'unpaid',
      payment_intent: makeIntent({ status: 'requires_payment_method', amount_received: 0 }) }));
    await processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient });
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_result).toBe('failed');
  });

  it('retrieves an unexpanded PaymentIntent before passing current facts to the DB', async () => {
    const raw = rawEvent('checkout.session.completed', 'evt_t31_pi_fetch');
    retrieveSession.mockResolvedValue(makeSession({ payment_intent: paymentIntentId }));
    await processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient });
    expect(retrieveIntent).toHaveBeenCalledWith(paymentIntentId);
    expect((rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_payment_intent_status).toBe('succeeded');
  });

  it('stores a valid but unsupported event as ignored without retrieving a Checkout Session', async () => {
    const raw = rawEvent('customer.updated', 'evt_t31_unsupported');
    rpc.mockResolvedValue({ data: { status: 'ignored' }, error: null });
    await expect(processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .resolves.toBe('ignored');
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('ignore_stripe_webhook_event', { p_event_id: 'evt_t31_unsupported', p_event_type: 'customer.updated' });
  });

  it('returns duplicate from the atomic event store without changing the response contract', async () => {
    const raw = rawEvent('checkout.session.completed', 'evt_t31_duplicate');
    rpc.mockResolvedValue({ data: { status: 'duplicate' }, error: null });
    await expect(processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .resolves.toBe('duplicate');
  });

  it('leaves delivery retryable when current-state retrieval or the DB write fails', async () => {
    const raw = rawEvent('checkout.session.completed', 'evt_t31_retry');
    retrieveSession.mockRejectedValue(new Error('network'));
    await expect(processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .rejects.toThrow('network');
    retrieveSession.mockResolvedValue(makeSession({ payment_intent: makeIntent() }));
    rpc.mockResolvedValue({ data: null, error: new Error('db') });
    await expect(processStripeWebhook({ rawBody: raw, signature: signature(raw), webhookSecret: secret, stripe: sdk, serviceClient }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
