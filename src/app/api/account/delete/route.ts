import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isDemoUser } from '@/lib/demo-auth';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { createCartServiceClient } from '@/server/cart/service-client';
import { claimDemoDeletion, processDemoDeletion, requestDemoDeletion } from '@/server/account/demo-retention';

const RequestBody = z.object({ confirmation: z.literal('アカウントを削除') }).strict();

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '削除確認を入力してください。'); }
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);
  let memberClient;
  try { memberClient = await createSupabaseServerClient(); }
  catch { return authError(503, 'UNAVAILABLE', '削除を受け付けられませんでした。再試行してください。'); }
  const { data: { user }, error: authFailure } = await memberClient.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '認証状態を確認できませんでした。再試行してください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'デモ会員のセッションを確認できません。');
  if (!isDemoUser(user)) return authError(403, 'FORBIDDEN', '通常会員の再認証付き削除は現在利用できません。');

  try {
    const serviceClient = createCartServiceClient();
    if (!(await requestDemoDeletion(serviceClient, user.id))) return authError(403, 'FORBIDDEN', 'デモ会員のセッションを確認できません。');
    const candidates = await claimDemoDeletion(serviceClient, 1, user.id);
    if (!candidates.includes(user.id)) return authSuccess({ status: 'queued' }, 202);
    const result = await processDemoDeletion({ client: serviceClient, userId: user.id });
    return authSuccess({ status: result }, result === 'deleted' ? 200 : 202);
  } catch { return authError(503, 'UNAVAILABLE', '削除を受け付けられませんでした。時間をおいて再試行してください。'); }
}
