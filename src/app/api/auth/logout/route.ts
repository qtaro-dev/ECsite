import { NextRequest } from 'next/server';
import { authError, authSuccess, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let error: unknown;
  try {
    const supabase = await createSupabaseServerClient();
    ({ error } = await supabase.auth.signOut());
  } catch { return authError(503, 'UNAVAILABLE', 'ログアウトできませんでした。時間をおいて再度お試しください。'); }
  if (error) return authError(503, 'UNAVAILABLE', 'ログアウトできませんでした。時間をおいて再度お試しください。');
  return authSuccess({ message: 'ログアウトしました。' });
}
