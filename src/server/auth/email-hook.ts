import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const hookPayloadSchema = z.object({
  user: z.object({ email: z.string().email().max(254) }).passthrough(),
  email_data: z.object({
    email_action_type: z.enum(['signup', 'recovery']),
    token_hash: z.string().min(1).max(512),
    redirect_to: z.string().max(2048).optional().default(''),
  }).passthrough(),
}).passthrough();

export type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export function verifyAuthEmailHookSignature(
  rawBody: string,
  headers: Headers,
  secret = process.env.AUTH_EMAIL_HOOK_SECRET,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false;
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatureHeader = headers.get('webhook-signature');
  if (!id || !/^[A-Za-z0-9._-]{1,128}$/.test(id) || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) return false;

  const encodedSecret = secret.replace(/^v1,whsec_/, '');
  let key: Buffer;
  try { key = Buffer.from(encodedSecret, 'base64'); } catch { return false; }
  if (key.length < 16) return false;

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  const signatures = signatureHeader.split(/\s+/).flatMap((item) => {
    const match = /^v1,([A-Za-z0-9+/=]+)$/.exec(item);
    return match ? [match[1]] : [];
  });
  const expectedBytes = Buffer.from(expected);
  return signatures.some((signature) => {
    const actualBytes = Buffer.from(signature);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  });
}

function configuredSiteOrigin(): URL | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return new URL(url.origin);
  } catch { return null; }
}

function safeRedirect(value: string, siteOrigin: URL): string {
  try {
    const redirect = new URL(value || '/auth/callback', siteOrigin);
    if (redirect.origin !== siteOrigin.origin || redirect.username || redirect.password) return new URL('/auth/callback', siteOrigin).toString();
    return redirect.toString();
  } catch { return new URL('/auth/callback', siteOrigin).toString(); }
}

export function buildAuthEmailMessage(payload: unknown): AuthEmailMessage | null {
  const parsed = hookPayloadSchema.safeParse(payload);
  const siteOrigin = configuredSiteOrigin();
  if (!parsed.success || !siteOrigin) return null;

  const { user, email_data: emailData } = parsed.data;
  let verifyUrl: URL;
  try {
    verifyUrl = new URL('/auth/v1/verify', process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!['http:', 'https:'].includes(verifyUrl.protocol) || verifyUrl.username || verifyUrl.password) return null;
  } catch { return null; }
  verifyUrl.searchParams.set('token', emailData.token_hash);
  verifyUrl.searchParams.set('type', emailData.email_action_type);
  verifyUrl.searchParams.set('redirect_to', safeRedirect(emailData.redirect_to, siteOrigin));

  if (emailData.email_action_type === 'signup') {
    return {
      to: user.email,
      subject: 'メールアドレスの確認',
      text: `ご登録ありがとうございます。次のリンクを開いてメールアドレスを確認してください。\n\n${verifyUrl.toString()}\n\nこの操作をしていない場合は、このメールを破棄してください。`,
    };
  }

  return {
    to: user.email,
    subject: 'パスワード再設定のご案内',
    text: `パスワード再設定のリンクをお送りします。次のリンクを開いて手続きを続けてください。\n\n${verifyUrl.toString()}\n\nこの操作をしていない場合は、このメールを破棄してください。`,
  };
}

export function isAllowedAuthEmailRecipient(recipient: string): boolean {
  const deployment = process.env.VERCEL_ENV;
  const environment = deployment ?? process.env.NODE_ENV;
  const allowlist = (process.env.SMTP_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  if (environment === 'production') return allowlist.length === 0 || allowlist.includes(recipient.toLowerCase());
  return allowlist.includes(recipient.toLowerCase());
}
