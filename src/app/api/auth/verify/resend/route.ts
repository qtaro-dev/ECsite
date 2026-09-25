import { NextRequest } from 'next/server';
import { AuthEmailSchema } from '@/lib/schemas';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AuthEmailSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  try {
    const supabase = await createSupabaseServerClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const next = safeReturnPath(new URL(request.url).searchParams.get('next'));
    const { error } = await supabase.auth.resend({
      type: 'signup', email: parsed.data.email,
      options: { emailRedirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, siteUrl).toString() },
    });
    // Provider errors can include account-specific states. Keep the public
    // response identical and direct the user to the same retry action.
    void error;
  } catch { return authError(503, 'UNAVAILABLE', '再送を受け付けられませんでした。時間をおいて再度お試しください。'); }
  // Always return the same response, whether the account exists or the provider throttles it.
  return authSuccess({ message: '確認が必要なアカウントがある場合、メールが届きます。届かない場合は時間をおいて再試行してください。' });
}
