import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const Candidates = z.array(z.object({
  order_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  session_id: z.string().nullable(),
}).strict()).max(3);
const ApplyResult = z.object({ status: z.enum(['processed', 'needs_review', 'already_resolved', 'already_paid', 'not_due']) }).strict();

export type ReconciliationFacts = {
  orderId: string; attemptId: string; result: 'succeeded' | 'failed' | 'expired' | 'pending' | 'unavailable';
  sessionId: string | null; sessionMode: string | null; livemode: boolean | null;
  sessionStatus: string | null; paymentStatus: string | null; amountTotal: number | null;
  currency: string | null; createdAt: number | null; expiresAt: number | null;
  sessionOrderId: string | null; sessionAttemptId: string | null;
  paymentIntentId: string | null; paymentIntentStatus: string | null;
  paymentIntentAmount: number | null; paymentIntentAmountReceived: number | null;
  paymentIntentCurrency: string | null; paymentIntentOrderId: string | null; paymentIntentAttemptId: string | null;
};

export class ReconciliationStoreError extends Error { constructor() { super('RECONCILIATION_STORE_UNAVAILABLE'); } }

export async function claimExpiredCheckoutAttempts(input: { serviceClient: SupabaseClient; limit: number }) {
  let result: { data: unknown; error: unknown };
  try { result = await input.serviceClient.rpc('claim_expired_checkout_attempts', { p_limit: input.limit }); }
  catch { throw new ReconciliationStoreError(); }
  if (result.error) throw new ReconciliationStoreError();
  const parsed = Candidates.safeParse(result.data);
  if (!parsed.success) throw new ReconciliationStoreError();
  return parsed.data.map((row) => ({ orderId: row.order_id, attemptId: row.attempt_id, sessionId: row.session_id }));
}

export async function applyReconciliationFacts(input: { serviceClient: SupabaseClient; facts: ReconciliationFacts }) {
  const f = input.facts;
  let result: { data: unknown; error: unknown };
  try {
    result = await input.serviceClient.rpc('apply_checkout_reconciliation', {
      p_order_id: f.orderId, p_attempt_id: f.attemptId, p_result: f.result,
      p_session_id: f.sessionId, p_session_mode: f.sessionMode, p_livemode: f.livemode,
      p_session_status: f.sessionStatus, p_payment_status: f.paymentStatus,
      p_amount_total_yen: f.amountTotal, p_currency: f.currency,
      p_session_created_at: f.createdAt, p_session_expires_at: f.expiresAt,
      p_session_order_id: f.sessionOrderId, p_session_attempt_id: f.sessionAttemptId,
      p_payment_intent_id: f.paymentIntentId, p_payment_intent_status: f.paymentIntentStatus,
      p_payment_intent_amount: f.paymentIntentAmount,
      p_payment_intent_amount_received: f.paymentIntentAmountReceived,
      p_payment_intent_currency: f.paymentIntentCurrency,
      p_payment_intent_order_id: f.paymentIntentOrderId,
      p_payment_intent_attempt_id: f.paymentIntentAttemptId,
    });
  } catch { throw new ReconciliationStoreError(); }
  if (result.error) throw new ReconciliationStoreError();
  const parsed = ApplyResult.safeParse(result.data);
  if (!parsed.success) throw new ReconciliationStoreError();
  return parsed.data;
}
