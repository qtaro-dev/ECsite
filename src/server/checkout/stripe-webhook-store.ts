import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const ApplyResult = z.object({ status: z.enum(['processed', 'ignored', 'needs_review', 'duplicate']) }).strict();
const IgnoreResult = z.object({ status: z.enum(['ignored', 'duplicate']) }).strict();

export type StripeWebhookSnapshot = {
  eventId: string; eventType: string; result: 'succeeded' | 'failed' | 'expired' | 'pending';
  orderId: string | null; attemptId: string | null; sessionId: string;
  sessionMode: string | null; livemode: boolean; sessionStatus: string | null; paymentStatus: string | null;
  sessionAmountYen: number | null; sessionCurrency: string | null; sessionCreatedAt: number | null; sessionExpiresAt: number | null;
  sessionMetadataOrderId: string | null; sessionMetadataAttemptId: string | null;
  paymentIntentId: string | null; paymentIntentStatus: string | null; paymentIntentAmount: number | null;
  paymentIntentAmountReceived: number | null; paymentIntentCurrency: string | null;
  paymentIntentMetadataOrderId: string | null; paymentIntentMetadataAttemptId: string | null;
};

export class StripeWebhookStoreError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'INVALID_RESPONSE') { super(code); }
}

export async function applyStripeWebhookSnapshot(input: { serviceClient: SupabaseClient; snapshot: StripeWebhookSnapshot }) {
  const s = input.snapshot;
  let result: { data: unknown; error: unknown };
  try {
    result = await input.serviceClient.rpc('apply_stripe_checkout_webhook', {
      p_event_id: s.eventId, p_event_type: s.eventType, p_result: s.result,
      p_order_id: s.orderId, p_attempt_id: s.attemptId, p_session_id: s.sessionId,
      p_session_mode: s.sessionMode, p_livemode: s.livemode, p_session_status: s.sessionStatus,
      p_payment_status: s.paymentStatus, p_session_amount_yen: s.sessionAmountYen,
      p_session_currency: s.sessionCurrency, p_session_created_at: s.sessionCreatedAt,
      p_session_expires_at: s.sessionExpiresAt, p_session_metadata_order_id: s.sessionMetadataOrderId,
      p_session_metadata_attempt_id: s.sessionMetadataAttemptId, p_payment_intent_id: s.paymentIntentId,
      p_payment_intent_status: s.paymentIntentStatus, p_payment_intent_amount: s.paymentIntentAmount,
      p_payment_intent_amount_received: s.paymentIntentAmountReceived, p_payment_intent_currency: s.paymentIntentCurrency,
      p_payment_intent_metadata_order_id: s.paymentIntentMetadataOrderId,
      p_payment_intent_metadata_attempt_id: s.paymentIntentMetadataAttemptId,
    });
  } catch { throw new StripeWebhookStoreError('UNAVAILABLE'); }
  if (result.error) throw new StripeWebhookStoreError('UNAVAILABLE');
  const parsed = ApplyResult.safeParse(result.data);
  if (!parsed.success) throw new StripeWebhookStoreError('INVALID_RESPONSE');
  return parsed.data;
}

export async function ignoreStripeWebhookEvent(input: { serviceClient: SupabaseClient; eventId: string; eventType: string }) {
  let result: { data: unknown; error: unknown };
  try {
    result = await input.serviceClient.rpc('ignore_stripe_webhook_event', {
      p_event_id: input.eventId, p_event_type: input.eventType,
    });
  } catch { throw new StripeWebhookStoreError('UNAVAILABLE'); }
  if (result.error) throw new StripeWebhookStoreError('UNAVAILABLE');
  const parsed = IgnoreResult.safeParse(result.data);
  if (!parsed.success) throw new StripeWebhookStoreError('INVALID_RESPONSE');
  return parsed.data;
}
