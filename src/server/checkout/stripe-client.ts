import 'server-only';
import Stripe from 'stripe';
import { StripeCheckoutError, requireStripeTestSecretKey } from './stripe-checkout';
import type { StripeCheckoutGateway } from './stripe-types';
import { createStripeCheckoutGateway } from './stripe-checkout';

/** Creates a bounded, server-only Stripe test client. Never fall back to a live key. */
export async function getStripeCheckoutGateway(): Promise<StripeCheckoutGateway> {
  let secretKey: string;
  try { secretKey = requireStripeTestSecretKey(process.env.STRIPE_SECRET_KEY); }
  catch { throw new StripeCheckoutError('configuration', 'CONFIGURATION'); }
  const sdk = new Stripe(secretKey, { timeout: 15_000, maxNetworkRetries: 0 });
  return createStripeCheckoutGateway(sdk);
}
