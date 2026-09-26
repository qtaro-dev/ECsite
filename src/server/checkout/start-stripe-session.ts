import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { failStripeCheckoutSession, recordStripeCheckoutSession } from './stripe-session-store';
import { StripeCheckoutError } from './stripe-checkout';
import type { StripeCheckoutGateway } from './stripe-types';

export type StartStripeSessionResult =
  | { ok: true; session: { id: string; url: string } }
  | { ok: false; reason: 'confirmed_failure' | 'allocation_window_elapsed' | 'ambiguous' | 'store_uncertain' };

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
}): Promise<StartStripeSessionResult> {
  let session: { id: string; url: string };
  try {
    session = await input.stripe.createSession({
      orderId: input.orderId,
      attemptId: input.attemptId,
      amountYen: input.amountYen,
      allocationExpiresAt: input.allocationExpiresAt,
      siteOrigin: input.siteOrigin,
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
