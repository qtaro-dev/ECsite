import 'server-only';
import Stripe from 'stripe';
import { requireStripeTestSecretKey } from './stripe-checkout';

export function getStripeWebhookClient() {
  const secretKey = requireStripeTestSecretKey(process.env.STRIPE_SECRET_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) throw new Error('WEBHOOK_CONFIGURATION');
  return {
    stripe: new Stripe(secretKey, { timeout: 15_000, maxNetworkRetries: 0 }),
    webhookSecret,
  };
}
