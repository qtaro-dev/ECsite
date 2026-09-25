import { isAuthBypassEnabled } from './bypass';

export type CheckoutIdentityState = {
  emailConfirmed: boolean;
  /** Trusted challenge state loaded by the server from T08 sms_challenges. */
  signupSmsVerified: boolean;
  /** Google OAuth accounts are exempt from SMS by the approved design. */
  provider: 'email' | 'google';
};

/** The caller must obtain all state from Supabase or a server-side challenge lookup. */
export function canStartCheckout(identity: CheckoutIdentityState): boolean {
  if (!identity.emailConfirmed && !isAuthBypassEnabled) return false;
  return identity.provider === 'google' || identity.signupSmsVerified || isAuthBypassEnabled;
}
