import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { sendAuthEmail } = vi.hoisted(() => ({ sendAuthEmail: vi.fn() }));
vi.mock('@/server/auth/smtp', () => ({ sendAuthEmail }));
vi.mock('server-only', () => ({}));

import { POST } from '@/app/api/auth/email-hook/route';
import { buildAuthEmailMessage, isAllowedAuthEmailRecipient, verifyAuthEmailHookSignature } from '@/server/auth/email-hook';

const secret = `v1,whsec_${Buffer.from('t20-test-hook-secret-which-is-long-enough').toString('base64')}`;
const payload = {
  user: { email: 'member@example.test', id: '00000000-0000-0000-0000-000000000001' },
  email_data: {
    email_action_type: 'signup', token_hash: 'signed-token-hash', redirect_to: 'https://attacker.example/steal',
  },
};

function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const id = 'msg_t20_1';
  const signature = createHmac('sha256', Buffer.from(secret.slice('v1,whsec_'.length), 'base64'))
    .update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

function request(body: string, headers: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/auth/email-hook', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
}

describe('Supabase Auth Send Email Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_EMAIL_HOOK_SECRET', secret);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'development');
    vi.stubEnv('SMTP_ALLOWED_RECIPIENTS', 'member@example.test');
    sendAuthEmail.mockResolvedValue(undefined);
  });

  it('verifies the raw body, rejects tampering, and rejects stale timestamps', () => {
    const body = JSON.stringify(payload);
    const headers = new Headers(signedHeaders(body));
    expect(verifyAuthEmailHookSignature(body, headers, secret)).toBe(true);
    expect(verifyAuthEmailHookSignature(`${body} `, headers, secret)).toBe(false);
    expect(verifyAuthEmailHookSignature(body, new Headers(signedHeaders(body, '1')), secret)).toBe(false);
    expect(verifyAuthEmailHookSignature(body, headers, 'invalid')).toBe(false);
  });

  it('builds only confirmation and reset messages and restricts redirects to the site origin', () => {
    const message = buildAuthEmailMessage(payload);
    expect(message?.subject).toBe('メールアドレスの確認');
    expect(message?.text).toContain('http://127.0.0.1:54321/auth/v1/verify?');
    expect(message?.text).toContain('redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback');
    expect(message?.text).not.toContain('attacker.example');

    const recovery = buildAuthEmailMessage({
      ...payload, email_data: { ...payload.email_data, email_action_type: 'recovery' },
    });
    expect(recovery?.subject).toBe('パスワード再設定のご案内');
    expect(buildAuthEmailMessage({ ...payload, email_data: { ...payload.email_data, email_action_type: 'magiclink' } })).toBeNull();
    expect(buildAuthEmailMessage({ ...payload, user: { email: 'not-an-email' } })).toBeNull();
  });

  it('requires an exact allowlist outside Production and honors an optional Production restriction', () => {
    expect(isAllowedAuthEmailRecipient('MEMBER@example.test')).toBe(true);
    expect(isAllowedAuthEmailRecipient('other@example.test')).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(isAllowedAuthEmailRecipient('other@example.test')).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SMTP_ALLOWED_RECIPIENTS', '');
    expect(isAllowedAuthEmailRecipient('other@example.test')).toBe(true);
    vi.stubEnv('SMTP_ALLOWED_RECIPIENTS', 'member@example.test');
    expect(isAllowedAuthEmailRecipient('other@example.test')).toBe(false);
  });

  it('sends valid signed messages and acknowledges with an empty 200 response', async () => {
    const body = JSON.stringify(payload);
    const response = await POST(request(body, signedHeaders(body)));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'member@example.test' }));
  });

  it('rejects invalid signatures, malformed or unsupported payloads, and disallowed recipients', async () => {
    const body = JSON.stringify(payload);
    expect((await POST(request(body, signedHeaders(body.replace('member@example.test', 'other@example.test'))))).status).toBe(401);
    expect((await POST(request('{', signedHeaders('{')))).status).toBe(400);
    const unsupported = JSON.stringify({ ...payload, email_data: { ...payload.email_data, email_action_type: 'magiclink' } });
    expect((await POST(request(unsupported, signedHeaders(unsupported)))).status).toBe(400);
    vi.stubEnv('SMTP_ALLOWED_RECIPIENTS', 'other@example.test');
    expect((await POST(request(body, signedHeaders(body)))).status).toBe(403);
    expect(sendAuthEmail).not.toHaveBeenCalled();
  });

  it('returns a generic retryable failure and does not expose SMTP details or message data', async () => {
    sendAuthEmail.mockRejectedValueOnce(new Error('smtp-password and provider diagnostic'));
    const body = JSON.stringify(payload);
    const response = await POST(request(body, signedHeaders(body)));
    const responseText = await response.text();
    expect(response.status).toBe(503);
    expect(responseText).not.toContain('smtp-password');
    expect(responseText).not.toContain('provider diagnostic');
    expect(responseText).not.toContain('member@example.test');
    expect(responseText).not.toContain('signed-token-hash');
  });
});
