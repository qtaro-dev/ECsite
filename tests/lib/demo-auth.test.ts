import { describe, expect, it } from 'vitest';
import { demoAuthFailure, isDemoUser } from '../../src/lib/demo-auth';
import { canStartCheckout } from '../../src/server/auth/eligibility';

describe('demo auth boundary', () => {
  it('identifies only signed Supabase anonymous users, never absent or regular accounts', () => {
    expect(isDemoUser({ is_anonymous: true })).toBe(true);
    expect(isDemoUser({ is_anonymous: false })).toBe(false);
    expect(isDemoUser(null)).toBe(false);
  });
  it('lets a real demo Auth session proceed without treating it as email verification bypass', () => {
    expect(canStartCheckout({ provider: 'demo', emailConfirmed: false, signupSmsVerified: false })).toBe(true);
    expect(canStartCheckout({ provider: 'email', emailConfirmed: false, signupSmsVerified: false })).toBe(false);
  });
  it('gives actionable, privacy-safe provider failure messages', () => {
    expect(demoAuthFailure(undefined, 429)).toContain('少し待って');
    expect(demoAuthFailure('anonymous_provider_disabled')).toContain('設定');
    expect(demoAuthFailure('internal_error')).not.toContain('internal_error');
  });
});
