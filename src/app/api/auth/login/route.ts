import { NextRequest } from 'next/server';
import { AuthCredentialsSchema } from '@/lib/schemas';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { isEmailConfirmationSatisfied } from '@/server/auth/bypass';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AuthCredentialsSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  let user: { email_confirmed_at?: string | null } | null = null;
  let error: unknown;
  try {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.auth.signInWithPassword(parsed.data);
    user = result.data.user;
    error = result.error;
  } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }
  if (error || !isEmailConfirmationSatisfied(user?.email_confirmed_at)) {
    return authError(401, 'UNAUTHORIZED', 'メールアドレスまたはパスワードを確認してください。');
  }
  return authSuccess({ returnTo: safeReturnPath(new URL(request.url).searchParams.get('next')) });
}
