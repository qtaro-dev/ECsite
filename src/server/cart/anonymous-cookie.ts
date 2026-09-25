import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ANONYMOUS_CART_COOKIE = 'ec_cart';
export const ANONYMOUS_CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Supabase Auth returns this named error when getUser() has no stored session. */
export function isAuthSessionMissing(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthSessionMissingError';
}

function secret(): Buffer {
  const value = process.env.ANON_CART_SIGNING_KEY;
  if (!value || Buffer.byteLength(value, 'utf8') < 32) throw new Error('ANON_CART_SIGNING_KEY must contain at least 32 bytes');
  return Buffer.from(value, 'utf8');
}

function signature(token: string): Buffer {
  return createHmac('sha256', secret()).update(`anonymous-cart:${token}`).digest();
}

export function createAnonymousCartCookieValue(): string {
  const token = randomBytes(32).toString('base64url');
  return `${token}.${signature(token).toString('base64url')}`;
}

export function anonymousCartTokenHash(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const [token, supplied, ...rest] = cookieValue.split('.');
  if (rest.length || !/^[A-Za-z0-9_-]{43}$/.test(token ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(supplied ?? '')) return null;
  const expected = signature(token);
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return createHmac('sha256', secret()).update(`anonymous-cart-owner:${token}`).digest('hex');
}
