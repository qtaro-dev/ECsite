import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, createSupabaseServerClient } = vi.hoisted(() => ({
  auth: { signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn() },
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient }));

import { GET as startGoogle } from '../../src/app/api/auth/google/route';
import { GET as callback } from '../../src/app/auth/callback/route';

describe('Google OAuth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://store.example.test');
    createSupabaseServerClient.mockResolvedValue({ auth });
    auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.test/oauth' }, error: null });
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({ data: { user: { app_metadata: { provider: 'google' } } } });
  });

  it('requests only the approved scopes and sends a sanitized same-site callback', async () => {
    const response = await startGoogle(new NextRequest('https://store.example.test/api/auth/google?next=%2Fcheckout%2Faddress'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://accounts.google.test/oauth');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://store.example.test/auth/callback?next=%2Fcheckout%2Faddress&flow=google',
        scopes: 'openid email profile',
      },
    });
  });

  it('shows a generic login failure when Supabase cannot start OAuth', async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: new Error('private provider detail') });
    const response = await startGoogle(new NextRequest('https://store.example.test/api/auth/google'));
    expect(response.headers.get('location')).toBe('https://store.example.test/login?error=google');
    expect(await response.text()).not.toContain('private provider detail');
  });

  it('replaces an external return URL with the account page', async () => {
    await startGoogle(new NextRequest('https://store.example.test/api/auth/google?next=https%3A%2F%2Fevil.example'));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        redirectTo: 'https://store.example.test/auth/callback?next=%2Faccount&flow=google',
      }),
    }));
  });

  it('exchanges the code and redirects Google users to the sanitized same-site path', async () => {
    const response = await callback(new NextRequest('https://attacker.example/auth/callback?code=opaque&next=%2Fcart'));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('opaque');
    expect(response.headers.get('location')).toBe('https://store.example.test/cart');
  });

  it('rejects an external callback destination even when it is supplied after OAuth', async () => {
    const response = await callback(new NextRequest('https://store.example.test/auth/callback?code=opaque&next=https%3A%2F%2Fevil.example'));
    expect(response.headers.get('location')).toBe('https://store.example.test/account');
  });

  it('keeps email confirmation users in the existing verification flow', async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: { email: 'member@example.test', app_metadata: { provider: 'email' } } } });
    const response = await callback(new NextRequest('https://store.example.test/auth/callback?code=opaque&next=%2Fcart'));
    expect(response.headers.get('location')).toBe('https://store.example.test/verify?confirmed=1&next=%2Fcart&email=member%40example.test');
  });

  it('returns OAuth failures to the configured site login', async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: new Error('private provider detail') });
    const response = await callback(new NextRequest('https://attacker.example/auth/callback?code=opaque&flow=google'));
    expect(response.headers.get('location')).toBe('https://store.example.test/login?error=google');
    expect(await response.text()).not.toContain('private provider detail');
  });

  it('keeps email confirmation callback failures on the existing verification error page', async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: new Error('expired email confirmation') });
    const response = await callback(new NextRequest('https://store.example.test/auth/callback?code=expired'));
    expect(response.headers.get('location')).toBe('https://store.example.test/verify?result=link-invalid');
  });

  it('returns Google cancellation to login when no authorization code is present', async () => {
    const response = await callback(new NextRequest('https://store.example.test/auth/callback?flow=google&error=access_denied'));
    expect(response.headers.get('location')).toBe('https://store.example.test/login?error=google');
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('uses a local fixed origin when the site URL is missing instead of trusting the request host', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const response = await callback(new NextRequest('https://attacker.example/auth/callback?code=opaque&next=%2Fcart'));
    expect(response.headers.get('location')).toBe('http://localhost:3000/cart');
  });
});
