import { NextRequest } from 'next/server';
import { AuthRegistrationSchema } from '@/lib/schemas';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AuthRegistrationSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  let error: unknown;
  try {
    const supabase = await createSupabaseServerClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const next = safeReturnPath(new URL(request.url).searchParams.get('next'));
    ({ error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: new URL(`/auth/callback?next=${encodeURIComponent(next)}`, siteUrl).toString() },
    }));
  } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }

  // Keep account existence and provider error details out of the response.
  if (error) return authError(400, 'BAD_REQUEST', '入力内容を確認し、時間をおいて再度お試しください。');
  return authSuccess({ message: '確認メールを送信しました。メール内のリンクを開いてください。' }, 201);
}
