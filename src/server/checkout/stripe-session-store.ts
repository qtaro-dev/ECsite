import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const RecordSessionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['stored', 'already_stored']) }).strict(),
  z.object({ status: z.enum(['not_found', 'session_conflict']) }).strict(),
]);
const FailSessionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['released', 'already_released']) }).strict(),
  z.object({ status: z.enum(['not_found', 'already_paid', 'session_exists']) }).strict(),
]);

export class StripeSessionStoreError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'INVALID_RESPONSE') { super(code); }
}

/** Saves the Stripe idempotent result without exposing the service key to a client. */
export async function recordStripeCheckoutSession(input: {
  serviceClient: SupabaseClient;
  orderId: string;
  attemptId: string;
  sessionId: string;
}) {
  let result: { data: unknown; error: unknown };
  try {
    result = await input.serviceClient.rpc('checkout_session_record', {
      p_order_id: input.orderId,
      p_attempt_id: input.attemptId,
      p_session_id: input.sessionId,
    });
  } catch { throw new StripeSessionStoreError('UNAVAILABLE'); }
  if (result.error) throw new StripeSessionStoreError('UNAVAILABLE');
  const parsed = RecordSessionResultSchema.safeParse(result.data);
  if (!parsed.success) throw new StripeSessionStoreError('INVALID_RESPONSE');
  return parsed.data;
}

/** Atomically fails the pending order and releases its inventory after a confirmed Stripe 4xx. */
export async function failStripeCheckoutSession(input: {
  serviceClient: SupabaseClient;
  orderId: string;
  attemptId: string;
  failureCode: 'stripe_rejected' | 'allocation_window_elapsed';
}) {
  let result: { data: unknown; error: unknown };
  try {
    result = await input.serviceClient.rpc('checkout_session_creation_failed', {
      p_order_id: input.orderId,
      p_attempt_id: input.attemptId,
      p_failure_code: input.failureCode,
    });
  } catch { throw new StripeSessionStoreError('UNAVAILABLE'); }
  if (result.error) throw new StripeSessionStoreError('UNAVAILABLE');
  const parsed = FailSessionResultSchema.safeParse(result.data);
  if (!parsed.success) throw new StripeSessionStoreError('INVALID_RESPONSE');
  return parsed.data;
}
