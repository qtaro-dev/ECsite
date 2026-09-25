import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, createSupabaseServerClient } = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), resend: vi.fn(), getUser: vi.fn(),
  },
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient }));

import { POST as register } from '../../src/app/api/auth/register/route';
import { POST as login } from '../../src/app/api/auth/login/route';
import { POST as logout } from '../../src/app/api/auth/logout/route';
import { POST as resend } from '../../src/app/api/auth/verify/resend/route';

function post(path: string, body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000/api${path}`, {
    method: 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('same-origin email authentication routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({ auth });
    auth.signUp.mockResolvedValue({ error: null });
    auth.signInWithPassword.mockResolvedValue({ data: { user: { email_confirmed_at: '2026-09-25T00:00:00.000Z' } }, error: null });
    auth.signOut.mockResolvedValue({ error: null });
    auth.resend.mockResolvedValue({ error: null });
  });

  it('rejects cross-site and missing-origin mutations before calling Supabase', async () => {
    const crossSite = await register(post('/auth/register', {}, 'https://attacker.example'));
    expect(crossSite.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    const noOrigin = await logout(post('/auth/logout', undefined, ''));
    expect(noOrigin.status).toBe(403);
  });

  it('validates registration, sends confirmation to a sanitized return path, and never returns the password', async () => {
    const password = 'T17-Test-Password-921!';
    const request = post('/auth/register?next=%2Fcheckout%2Faddress', {
      email: 'member@example.test', password, passwordConfirmation: password, acceptedTerms: true,
    });
    const response = await register(request);
    expect(response.status).toBe(201);
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'member@example.test', password,
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback?next=%2Fcheckout%2Faddress' },
    }));
    const responseBody = await response.text();
    expect(responseBody).not.toContain(password);
    expect(JSON.parse(responseBody).data.message).toContain('確認メール');
  });

  it('returns one generic login failure for invalid credentials and unconfirmed accounts', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: new Error('no user') });
    const unknownAccount = await login(post('/auth/login', { email: 'x@example.test', password: 'T17-Test-Password-921!' }));
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { email_confirmed_at: null } }, error: null });
    const unconfirmed = await login(post('/auth/login', { email: 'x@example.test', password: 'T17-Test-Password-921!' }));
    expect(unknownAccount.status).toBe(401);
    expect(unconfirmed.status).toBe(401);
    const unknownBody = JSON.parse(await unknownAccount.text());
    const unconfirmedBody = JSON.parse(await unconfirmed.text());
    expect(unknownBody.error).toEqual(unconfirmedBody.error);
  });

  it('sanitizes the login return path before returning it to the browser', async () => {
    const response = await login(post('/auth/login?next=https%3A%2F%2Fevil.example', {
      email: 'member@example.test', password: 'T17-Test-Password-921!',
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.returnTo).toBe('/account');
  });

  it('keeps resend responses generic even when Supabase reports an error', async () => {
    auth.resend.mockResolvedValueOnce({ error: new Error('rate limited for existing account') });
    const response = await resend(post('/auth/verify/resend', { email: 'member@example.test' }));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('existing account');
  });

  it('clears the session on logout', async () => {
    const response = await logout(post('/auth/logout'));
    expect(response.status).toBe(200);
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
