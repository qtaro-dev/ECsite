import 'server-only';
import type Stripe from 'stripe';
import { applyStripeWebhookSnapshot, ignoreStripeWebhookEvent, type StripeWebhookSnapshot } from './stripe-webhook-store';

const checkoutEventTypes = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

export type StripeWebhookSdk = Pick<Stripe, 'webhooks'> & {
  checkout: Pick<Stripe['checkout'], 'sessions'>;
  paymentIntents: Pick<Stripe['paymentIntents'], 'retrieve'>;
};

export type StripeWebhookOutcome = 'processed' | 'ignored' | 'needs_review' | 'duplicate' | 'invalid_signature';

function metadataValue(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !('metadata' in value)) return null;
  const metadata = (value as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const item = (metadata as Record<string, unknown>)[key];
  return typeof item === 'string' ? item : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'id' in value && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

function uuidOrNull(value: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function currentResult(input: {
  eventType: string;
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent | null;
}): StripeWebhookSnapshot['result'] {
  const { session, paymentIntent, eventType } = input;
  // Current success wins even when Stripe retries an older failure or expiry event.
  if (session.status === 'complete' && session.payment_status === 'paid' && paymentIntent?.status === 'succeeded') return 'succeeded';
  if (session.status === 'expired') {
    if (paymentIntent && ['processing', 'requires_action', 'requires_confirmation', 'requires_capture'].includes(paymentIntent.status)) return 'pending';
    return 'expired';
  }
  if (eventType === 'checkout.session.async_payment_failed'
    && session.status === 'complete' && session.payment_status === 'unpaid'
    && paymentIntent && ['requires_payment_method', 'canceled'].includes(paymentIntent.status)) return 'failed';
  return 'pending';
}

function paymentIntentObject(value: Stripe.Checkout.Session['payment_intent']): Stripe.PaymentIntent | null {
  return typeof value === 'object' && value !== null ? value as Stripe.PaymentIntent : null;
}

/** Verifies the exact raw bytes, reads Stripe's current state, then applies it atomically. */
export async function processStripeWebhook(input: {
  rawBody: Buffer;
  signature: string;
  webhookSecret: string;
  stripe: StripeWebhookSdk;
  serviceClient: Parameters<typeof applyStripeWebhookSnapshot>[0]['serviceClient'];
}): Promise<StripeWebhookOutcome> {
  let event: Stripe.Event;
  try { event = input.stripe.webhooks.constructEvent(input.rawBody, input.signature, input.webhookSecret); }
  catch { return 'invalid_signature'; }

  if (!event.id || !event.type) throw new Error('SIGNED_EVENT_SHAPE_INVALID');
  if (!checkoutEventTypes.has(event.type)) {
    const stored = await ignoreStripeWebhookEvent({ serviceClient: input.serviceClient, eventId: event.id, eventType: event.type });
    return stored.status;
  }

  const eventObject = event.data.object as Stripe.Checkout.Session;
  if (eventObject.object !== 'checkout.session' || typeof eventObject.id !== 'string' || !/^cs_test_[A-Za-z0-9_]+$/.test(eventObject.id)) {
    throw new Error('SIGNED_CHECKOUT_EVENT_SHAPE_INVALID');
  }

  const session = await input.stripe.checkout.sessions.retrieve(eventObject.id, { expand: ['payment_intent'] });
  if (session.id !== eventObject.id) throw new Error('CHECKOUT_SESSION_LOOKUP_MISMATCH');
  let paymentIntent = paymentIntentObject(session.payment_intent);
  const paymentIntentId = stripeId(session.payment_intent);
  if (paymentIntentId && !paymentIntent) paymentIntent = await input.stripe.paymentIntents.retrieve(paymentIntentId);
  const rawOrderId = metadataValue(session, 'order_id');
  const rawAttemptId = metadataValue(session, 'attempt_id');
  const snapshot: StripeWebhookSnapshot = {
    eventId: event.id,
    eventType: event.type,
    result: currentResult({ eventType: event.type, session, paymentIntent }),
    orderId: uuidOrNull(rawOrderId),
    attemptId: uuidOrNull(rawAttemptId),
    sessionId: session.id,
    sessionMode: session.mode,
    livemode: session.livemode,
    sessionStatus: session.status,
    paymentStatus: session.payment_status,
    sessionAmountYen: safeInteger(session.amount_total),
    sessionCurrency: stringValue(session.currency),
    sessionCreatedAt: safeInteger(session.created),
    sessionExpiresAt: safeInteger(session.expires_at),
    sessionMetadataOrderId: rawOrderId,
    sessionMetadataAttemptId: rawAttemptId,
    paymentIntentId,
    paymentIntentStatus: paymentIntent?.status ?? null,
    paymentIntentAmount: safeInteger(paymentIntent?.amount),
    paymentIntentAmountReceived: safeInteger(paymentIntent?.amount_received),
    paymentIntentCurrency: paymentIntent?.currency ?? null,
    paymentIntentMetadataOrderId: metadataValue(paymentIntent, 'order_id'),
    paymentIntentMetadataAttemptId: metadataValue(paymentIntent, 'attempt_id'),
  };
  const applied = await applyStripeWebhookSnapshot({ serviceClient: input.serviceClient, snapshot });
  return applied.status;
}
