import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { failStripeCheckoutSession, prepareStripeCheckoutSession, recordStripeCheckoutSession } from './stripe-session-store';
import { StripeCheckoutError } from './stripe-checkout';
import type { StripeCheckoutGateway } from './stripe-types';

export type StartStripeSessionResult =
  | { ok: true; session: { id: string; url: string } }
  | { ok: false; reason: 'confirmed_failure' | 'allocation_window_elapsed' | 'session_expired' | 'ambiguous' | 'store_uncertain' };

/** Creates/replays the same Stripe Session and persists its ID without ever
 * releasing inventory for an ambiguous SDK or database response. */
export async function startStripeSession(input: {
  stripe: StripeCheckoutGateway;
  serviceClient: SupabaseClient;
  orderId: string;
  attemptId: string;
  amountYen: number;
  allocationExpiresAt: string;
  idempotencyKey: string;
  siteOrigin: string;
  demoUserId?: string;
}): Promise<StartStripeSessionResult> {
  let prepared;
  try {
    prepared = await prepareStripeCheckoutSession({
      serviceClient: input.serviceClient,
      orderId: input.orderId,
      attemptId: input.attemptId,
      siteOrigin: input.siteOrigin,
    });
  } catch { return { ok: false, reason: 'store_uncertain' }; }
  if (prepared.status === 'allocation_window_elapsed') {
    try {
      const compensated = await failStripeCheckoutSession({
        serviceClient: input.serviceClient,
        orderId: input.orderId,
        attemptId: input.attemptId,
        failureCode: 'allocation_window_elapsed',
      });
      if (compensated.status === 'released' || compensated.status === 'already_released') {
        return { ok: false, reason: 'allocation_window_elapsed' };
      }
    } catch { /* Keep the order for reconciliation when compensation is uncertain. */ }
    return { ok: false, reason: 'store_uncertain' };
  }
  if (prepared.status === 'session_expired') return { ok: false, reason: 'session_expired' };
  if (prepared.status !== 'prepared' && prepared.status !== 'already_prepared') {
    return { ok: false, reason: 'store_uncertain' };
  }

  let session: { id: string; url: string };
  try {
    session = await input.stripe.createSession({
      orderId: input.orderId,
      attemptId: input.attemptId,
      amountYen: input.amountYen,
      allocationExpiresAt: input.allocationExpiresAt,
      expiresAtEpochSeconds: prepared.expiresAtEpochSeconds,
      siteOrigin: prepared.siteOrigin,
      demoUserId: input.demoUserId,
    }, input.idempotencyKey);
  } catch (error) {
    if (!(error instanceof StripeCheckoutError) || error.kind !== 'definitive_failure') return { ok: false, reason: 'ambiguous' };
    try {
      const failureCode = error.code === 'ALLOCATION_WINDOW_ELAPSED' ? 'allocation_window_elapsed' : 'stripe_rejected';
      const compensated = await failStripeCheckoutSession({
        serviceClient: input.serviceClient,
        orderId: input.orderId,
        attemptId: input.attemptId,
        failureCode,
      });
      if (compensated.status !== 'released' && compensated.status !== 'already_released') return { ok: false, reason: 'store_uncertain' };
      return { ok: false, reason: error.code === 'ALLOCATION_WINDOW_ELAPSED' ? 'allocation_window_elapsed' : 'confirmed_failure' };
    } catch { return { ok: false, reason: 'store_uncertain' }; }
  }

  try {
    const stored = await recordStripeCheckoutSession({
      serviceClient: input.serviceClient,
      orderId: input.orderId,
      attemptId: input.attemptId,
      sessionId: session.id,
    });
    if (stored.status !== 'stored' && stored.status !== 'already_stored') return { ok: false, reason: 'store_uncertain' };
  } catch { return { ok: false, reason: 'store_uncertain' }; }
  return { ok: true, session };
}
