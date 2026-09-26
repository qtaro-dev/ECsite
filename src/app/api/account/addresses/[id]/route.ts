import { NextRequest } from 'next/server';
import { IdSchema } from '@/lib/schemas';
import { authError, authSuccess, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  const { id } = await context.params;
  if (!IdSchema.safeParse(id).success) return authError(400, 'BAD_REQUEST', '入力内容を確認してください。');
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }
  const { data: { user }, error: authFailure } = await supabase.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  const { data, error } = await supabase.from('addresses').delete().eq('id', id).select('id').maybeSingle();
  if (error) return authError(503, 'UNAVAILABLE', '配送先を削除できませんでした。時間をおいて再度お試しください。');
  if (!data) return authError(404, 'NOT_FOUND', '配送先が見つかりません。');
  return authSuccess({ deleted: true });
}
