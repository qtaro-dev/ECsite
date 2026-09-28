import { NextRequest } from 'next/server';
import { PaidCartCleanupRequestSchema, PaidCartCleanupResultSchema } from '@/lib/cart-cleanup-schemas';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { createCartServiceClient } from '@/server/cart/service-client';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '注文IDを確認してください。'); }
  const input = PaidCartCleanupRequestSchema.safeParse(body);
  if (!input.success) return authValidationError(input.error);
  let memberClient;
  try { memberClient = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。'); }
  let user;
  try {
    const auth = await memberClient.auth.getUser();
    if (auth.error && !isAuthSessionMissing(auth.error)) return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。');
    user = auth.data.user;
  } catch { return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。'); }
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  try {
    const serviceClient = createCartServiceClient();
    const { data, error } = await serviceClient.rpc('clear_paid_order_cart', { p_user_id: user.id, p_order_id: input.data.orderId });
    if (error) return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。');
    const result = PaidCartCleanupResultSchema.safeParse(data);
    if (!result.success) return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。');
    if (result.data.status === 'not_found') return authError(404, 'NOT_FOUND', '注文が見つかりません。');
    return authSuccess(result.data);
  } catch { return authError(503, 'UNAVAILABLE', 'カートを整理できません。時間をおいてお試しください。'); }
}
