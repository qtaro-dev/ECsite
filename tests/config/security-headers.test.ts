import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';

describe('site security headers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('denies framing and limits document/form base behavior without changing script policy', async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find((candidate) => candidate.source === '/:path*');
    const headers = Object.fromEntries((rule?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]));

    expect(headers['content-security-policy']).toBe(
      "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(headers['content-security-policy']).not.toMatch(/script-src|default-src/);
  });

  it('only enables HSTS for production builds and does not cover shared Vercel subdomains', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const developmentRules = await nextConfig.headers?.();
    expect(developmentRules?.[0]?.headers.some(({ key }) => key === 'Strict-Transport-Security')).toBe(false);

    vi.stubEnv('NODE_ENV', 'production');
    const productionRules = await nextConfig.headers?.();
    expect(productionRules?.[0]?.headers).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000',
    });
  });
});
