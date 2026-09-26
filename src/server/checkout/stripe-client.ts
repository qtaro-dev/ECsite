import 'server-only';
import { StripeCheckoutError, requireStripeTestSecretKey } from './stripe-checkout';
import type { StripeCheckoutGateway } from './stripe-types';

/** T37 owns package.json/package-lock until its merge; the SDK adapter is wired after that gate. */
export async function getStripeCheckoutGateway(): Promise<StripeCheckoutGateway> {
  requireStripeTestSecretKey(process.env.STRIPE_SECRET_KEY);
  throw new StripeCheckoutError('configuration', 'CONFIGURATION');
}
