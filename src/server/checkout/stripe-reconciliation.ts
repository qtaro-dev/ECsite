import 'server-only';
import Stripe from 'stripe';
import { requireStripeTestSecretKey } from './stripe-checkout';
import type { ReconciliationFacts } from './reconciliation-store';

export type ReconciliationStripeClient = Pick<Stripe, 'checkout' | 'paymentIntents'>;

export function getReconciliationStripeClient(): Stripe {
  const secret = requireStripeTestSecretKey(process.env.STRIPE_SECRET_KEY);
  return new Stripe(secret, { timeout: 15_000, maxNetworkRetries: 0 });
}

function metadata(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || !('metadata' in value)) return null;
  const metadataValue = (value as { metadata?: unknown }).metadata;
  if (!metadataValue || typeof metadataValue !== 'object') return null;
  const field = (metadataValue as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

function integer(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) ? value : null; }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function intentObject(value: Stripe.Checkout.Session['payment_intent']): Stripe.PaymentIntent | null {
  return typeof value === 'object' && value !== null ? value as Stripe.PaymentIntent : null;
}

export function classifyReconciliationResult(input: {
  session: Stripe.Checkout.Session; paymentIntent: Stripe.PaymentIntent | null;
}): ReconciliationFacts['result'] {
  const { session, paymentIntent } = input;
  if (session.status === 'complete' && session.payment_status === 'paid' && paymentIntent?.status === 'succeeded') return 'succeeded';
  if (session.status === 'complete' && session.payment_status === 'unpaid'
    && paymentIntent && ['requires_payment_method', 'canceled'].includes(paymentIntent.status)) return 'failed';
  if (session.status === 'expired' && session.payment_status === 'unpaid'
    && (!paymentIntent || !['succeeded', 'processing', 'requires_action', 'requires_confirmation', 'requires_capture'].includes(paymentIntent.status))) return 'expired';
  return 'pending';
}

export async function readStripeReconciliationFacts(input: {
  stripe: ReconciliationStripeClient; orderId: string; attemptId: string; sessionId: string;
}): Promise<ReconciliationFacts> {
  const session = await input.stripe.checkout.sessions.retrieve(input.sessionId, { expand: ['payment_intent'] });
  let paymentIntent = intentObject(session.payment_intent);
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  if (paymentIntentId && !paymentIntent) paymentIntent = await input.stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    orderId: input.orderId, attemptId: input.attemptId,
    result: classifyReconciliationResult({ session, paymentIntent }),
    sessionId: session.id, sessionMode: session.mode, livemode: session.livemode,
    sessionStatus: session.status, paymentStatus: session.payment_status,
    amountTotal: integer(session.amount_total), currency: string(session.currency),
    createdAt: integer(session.created), expiresAt: integer(session.expires_at),
    sessionOrderId: metadata(session, 'order_id'), sessionAttemptId: metadata(session, 'attempt_id'),
    paymentIntentId, paymentIntentStatus: paymentIntent?.status ?? null,
    paymentIntentAmount: integer(paymentIntent?.amount), paymentIntentAmountReceived: integer(paymentIntent?.amount_received),
    paymentIntentCurrency: paymentIntent?.currency ?? null,
    paymentIntentOrderId: metadata(paymentIntent, 'order_id'), paymentIntentAttemptId: metadata(paymentIntent, 'attempt_id'),
  };
}

export function unavailableReconciliationFacts(input: { orderId: string; attemptId: string; sessionId: string | null }): ReconciliationFacts {
  return {
    orderId: input.orderId, attemptId: input.attemptId, result: 'unavailable',
    sessionId: input.sessionId, sessionMode: null, livemode: null, sessionStatus: null, paymentStatus: null,
    amountTotal: null, currency: null, createdAt: null, expiresAt: null,
    sessionOrderId: null, sessionAttemptId: null, paymentIntentId: null, paymentIntentStatus: null,
    paymentIntentAmount: null, paymentIntentAmountReceived: null, paymentIntentCurrency: null,
    paymentIntentOrderId: null, paymentIntentAttemptId: null,
  };
}
