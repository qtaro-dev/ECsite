import type { StripeCheckoutSession, StripeCheckoutSessionInput } from './stripe-checkout';

export type StripeCheckoutGateway = {
  createSession(input: StripeCheckoutSessionInput, idempotencyKey: string): Promise<StripeCheckoutSession>;
};
