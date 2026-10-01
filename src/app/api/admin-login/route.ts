import { NextRequest } from 'next/server';
import { AuthCredentialsSchema } from '@/lib/schemas';
import { isEmailConfirmationSatisfied } from '@/server/auth/bypass';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isActiveAdmin } from '@/server/admin/bootstrap';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AuthCredentialsSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  try {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.signInWithPassword(parsed.data);
    if (result.error || !result.data.user || result.data.user.is_anonymous
      || !isEmailConfirmationSatisfied(result.data.user.email_confirmed_at)) {
      return authError(401, 'UNAUTHORIZED', 'メールアドレスまたはパスワードを確認してください。');
    }
    let admin = false;
    try { admin = await isActiveAdmin(result.data.user.id); } catch {
      await supabase.auth.signOut();
      return authError(503, 'UNAVAILABLE', '管理者権限を確認できませんでした。');
    }
    if (!admin) {
      await supabase.auth.signOut();
      return authError(403, 'FORBIDDEN', 'このアカウントには管理者権限がありません。初回セットアップが完了済みの場合は運用担当者へお問い合わせください。');
    }
    return authSuccess({ returnTo: '/admin' });
  } catch {
    return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。');
  }
}
