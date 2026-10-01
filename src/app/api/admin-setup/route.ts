import { NextRequest } from 'next/server';
import { AdminSetupSchema } from '@/lib/schemas';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { consumeAdminSetupAttempt, createFirstAdmin, isFirstAdminSetupOpen } from '@/server/admin/bootstrap';
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function GET() {
  try { return authSuccess({ available: await isFirstAdminSetupOpen() }); }
  catch { return authError(503, 'UNAVAILABLE', '現在セットアップ状態を確認できません。'); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AdminSetupSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  const expected = process.env.ADMIN_SETUP_CODE;
  if (!expected || Buffer.byteLength(expected) < 32) return authError(503, 'UNAVAILABLE', '初回セットアップの設定がありません。');
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',').at(-1)?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const window = Math.floor(Date.now() / 600_000);
  const bucketHash = createHmac('sha256', expected).update(`${ip}:${window}`).digest('hex');
  try {
    if (!await consumeAdminSetupAttempt(bucketHash)) return authError(429, 'RATE_LIMITED', 'しばらく待ってから再度お試しください。');
  } catch { return authError(503, 'UNAVAILABLE', '現在セットアップできません。'); }
  const suppliedDigest = createHmac('sha256', 't56-admin-setup').update(parsed.data.setupCode).digest();
  const expectedDigest = createHmac('sha256', 't56-admin-setup').update(expected).digest();
  if (!timingSafeEqual(suppliedDigest, expectedDigest)) return authError(403, 'FORBIDDEN', 'セットアップコードを確認してください。');

  try {
    const created = await createFirstAdmin(parsed.data.email, parsed.data.password, crypto.randomUUID());
    if (!created) return authError(409, 'CONFLICT', '初回セットアップは既に完了しています。');
    return authSuccess({ message: '管理者アカウントを作成しました。管理者ログインからログインしてください。' }, 201);
  } catch {
    return authError(503, 'UNAVAILABLE', '作成できませんでした。設定を確認して再度お試しください。');
  }
}
