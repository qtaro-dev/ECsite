import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authBypassConfigurationError } from '../../src/server/auth/bypass';
import { canStartCheckout } from '../../src/server/auth/eligibility';
import { safeReturnPath } from '../../src/server/auth/safe-return-path';

describe('safeReturnPath', () => {
  it.each(['/checkout/address', '/cart?item=1#summary'])('keeps a same-site path: %s', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });
  it.each(['https://evil.example', '//evil.example/path', '/\\evil.example', '/%2f%2fevil.example', '/login', '/register', '/verify', '/%zz'])('rejects an unsafe or looping path: %s', (path) => {
    expect(safeReturnPath(path)).toBe('/account');
  });
});

describe('authentication bypass configuration', () => {
  it('accepts only development and test settings', () => {
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'development' })).toBeNull();
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'test' })).toBeNull();
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'false', NODE_ENV: 'production', VERCEL_ENV: 'production' })).toBeNull();
  });
  it('rejects an enabled bypass in either production signal and unknown modes', () => {
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'production' })).toMatch(/production/);
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'test', VERCEL_ENV: 'production' })).toMatch(/production/);
    expect(authBypassConfigurationError({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'preview' })).toMatch(/development or test/);
  });
});

describe('checkout identity boundary', () => {
  it('requires confirmed email and trusted registration SMS verification for email accounts', () => {
    expect(canStartCheckout({ emailConfirmed: false, signupSmsVerified: true, provider: 'email' })).toBe(false);
    expect(canStartCheckout({ emailConfirmed: true, signupSmsVerified: false, provider: 'email' })).toBe(false);
    expect(canStartCheckout({ emailConfirmed: true, signupSmsVerified: true, provider: 'email' })).toBe(true);
  });
  it('allows Google accounts after email confirmation without SMS', () => {
    expect(canStartCheckout({ emailConfirmed: true, signupSmsVerified: false, provider: 'google' })).toBe(true);
    expect(canStartCheckout({ emailConfirmed: false, signupSmsVerified: false, provider: 'google' })).toBe(false);
  });
});
