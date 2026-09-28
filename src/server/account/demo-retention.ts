import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { z } from 'zod';
import { getReconciliationStripeClient } from '@/server/checkout/stripe-reconciliation';

const CandidateSchema = z.array(z.object({ user_id: z.string().uuid() }).strict()).max(5);
const FinishSchema = z.enum(['deleted', 'not_found', 'forbidden', 'payment_pending']);
type RetentionErrorCode = 'payment_pending' | 'stripe_unavailable' | 'auth_unavailable' | 'db_unavailable' | 'unexpected';

export class DemoRetentionError extends Error {
  constructor(readonly code: RetentionErrorCode) { super(code); }
}

export async function requestDemoDeletion(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc('request_demo_retention', { p_user_id: userId });
  if (error || typeof data !== 'boolean') throw new DemoRetentionError('db_unavailable');
  return data;
}

export async function claimDemoDeletion(client: SupabaseClient, limit: number, userId: string | null = null): Promise<string[]> {
  const { data, error } = await client.rpc('claim_demo_retention', { p_limit: limit, p_user_id: userId });
  if (error) throw new DemoRetentionError('db_unavailable');
  const parsed = CandidateSchema.safeParse(data);
  if (!parsed.success) throw new DemoRetentionError('db_unavailable');
  return parsed.data.map((row) => row.user_id);
}

export async function deferDemoDeletion(client: SupabaseClient, userId: string, code: RetentionErrorCode): Promise<void> {
  const { error } = await client.rpc('defer_demo_retention', { p_user_id: userId, p_code: code });
  if (error) throw new DemoRetentionError('db_unavailable');
}

type StripeRetentionClient = Pick<Stripe, 'checkout' | 'customers' | 'paymentIntents'>;

/** Every external call is idempotent. The final DB RPC rechecks payment and
 * allocation state under locks before cascading away the Auth user. */
export async function processDemoDeletion(input: {
  client: SupabaseClient; userId: string; stripe?: StripeRetentionClient;
}): Promise<'deleted' | 'deferred'> {
  const { client, userId } = input;
  try {
    const auth = await client.auth.admin.getUserById(userId);
    if (auth.error) throw new DemoRetentionError('auth_unavailable');
    if (auth.data.user && auth.data.user.is_anonymous !== true) throw new DemoRetentionError('unexpected');
    const ordersResult = await client.from('orders').select('id,status').eq('user_id', userId);
    if (ordersResult.error) throw new DemoRetentionError('db_unavailable');
    const orders = ordersResult.data ?? [];
    if (orders.some((order) => ['payment_pending', 'review_required'].includes(order.status))) {
      throw new DemoRetentionError('payment_pending');
    }
    if (orders.length) {
      const attemptsResult = await client.from('payment_attempts').select('id,order_id,state,stripe_session_id,amount_yen')
        .in('order_id', orders.map((order) => order.id));
      if (attemptsResult.error) throw new DemoRetentionError('db_unavailable');
      const attempts = attemptsResult.data ?? [];
      if (attempts.some((attempt) => ['created', 'processing', 'review_required'].includes(attempt.state))) {
        throw new DemoRetentionError('payment_pending');
      }
      const sessions = attempts.filter((attempt) => attempt.stripe_session_id);
      if (sessions.length) {
        let stripe: StripeRetentionClient;
        try { stripe = input.stripe ?? getReconciliationStripeClient(); }
        catch { throw new DemoRetentionError('stripe_unavailable'); }
        for (const attempt of sessions) {
          if (!/^cs_test_[A-Za-z0-9_]+$/.test(attempt.stripe_session_id!)) throw new DemoRetentionError('stripe_unavailable');
          let session: Stripe.Checkout.Session;
          try { session = await stripe.checkout.sessions.retrieve(attempt.stripe_session_id!, { expand: ['payment_intent'] }); }
          catch { throw new DemoRetentionError('stripe_unavailable'); }
          if (session.id !== attempt.stripe_session_id || session.livemode !== false
            || session.mode !== 'payment'
            || session.metadata?.order_id !== attempt.order_id || session.metadata?.attempt_id !== attempt.id
            || session.currency !== 'jpy' || session.amount_total !== attempt.amount_yen
            || session.status === 'open') throw new DemoRetentionError('payment_pending');

          const paymentIntentRef = session.payment_intent;
          const paymentIntentId = typeof paymentIntentRef === 'string' ? paymentIntentRef : paymentIntentRef?.id ?? null;
          let paymentIntent = typeof paymentIntentRef === 'object' && paymentIntentRef !== null
            ? paymentIntentRef as Stripe.PaymentIntent : null;
          if (paymentIntentId && !paymentIntent) {
            try { paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId); }
            catch { throw new DemoRetentionError('stripe_unavailable'); }
          }
          if (paymentIntent && (paymentIntent.id !== paymentIntentId || paymentIntent.livemode !== false
            || paymentIntent.metadata?.order_id !== attempt.order_id || paymentIntent.metadata?.attempt_id !== attempt.id
            || paymentIntent.currency !== 'jpy')) throw new DemoRetentionError('payment_pending');

          const orderStatus = orders.find((order) => order.id === attempt.order_id)?.status;
          const pendingIntentStates = ['succeeded', 'processing', 'requires_action', 'requires_confirmation', 'requires_capture'];
          const paidMatches = orderStatus === 'paid' && session.status === 'complete' && session.payment_status === 'paid'
            && paymentIntent?.status === 'succeeded' && paymentIntent.amount_received === attempt.amount_yen;
          const failedMatches = orderStatus === 'payment_failed' && session.status === 'complete' && session.payment_status === 'unpaid'
            && paymentIntent !== null && ['requires_payment_method', 'canceled'].includes(paymentIntent.status)
            && paymentIntent.amount_received === 0;
          const expiredMatches = orderStatus === 'expired' && session.status === 'expired' && session.payment_status === 'unpaid'
            && (!paymentIntentId || (paymentIntent !== null && paymentIntent.amount_received === 0
              && !pendingIntentStates.includes(paymentIntent.status)));
          if (!paidMatches && !failedMatches && !expiredMatches) {
            throw new DemoRetentionError('payment_pending');
          }
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
          if (customerId) {
            if (!/^cus_[A-Za-z0-9_]+$/.test(customerId)) throw new DemoRetentionError('stripe_unavailable');
            try {
              const deleted = await stripe.customers.del(customerId);
              if (!deleted.deleted) throw new DemoRetentionError('stripe_unavailable');
            } catch (error) {
              if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== 'resource_missing') {
                throw new DemoRetentionError('stripe_unavailable');
              }
            }
          }
        }
      }
    }
    const finished = await client.rpc('finish_demo_retention', { p_user_id: userId });
    if (finished.error) throw new DemoRetentionError('db_unavailable');
    const parsed = FinishSchema.safeParse(finished.data);
    if (!parsed.success || parsed.data === 'forbidden') throw new DemoRetentionError('db_unavailable');
    if (parsed.data === 'payment_pending') throw new DemoRetentionError('payment_pending');
    return 'deleted';
  } catch (error) {
    const code = error instanceof DemoRetentionError ? error.code : 'unexpected';
    await deferDemoDeletion(client, userId, code);
    return 'deferred';
  }
}
