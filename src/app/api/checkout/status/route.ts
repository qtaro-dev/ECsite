import { NextRequest } from 'next/server';
import { IdSchema } from '@/lib/schemas';
import { describeOrderState, OrderStateSchema } from '@/lib/order-display';
import { authError, authSuccess } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { readOwnedOrderStatus } from '@/server/orders/order-read';

export async function GET(request: NextRequest) {
  const query = new URL(request.url).searchParams;
  const orderId = IdSchema.safeParse(query.get('orderId'));
  if (!orderId.success || [...query.keys()].some((key) => key !== 'orderId') || query.getAll('orderId').length !== 1) {
    return authError(400, 'BAD_REQUEST', '注文IDを確認してください。');
  }
  let client;
  try { client = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', '注文状況を確認できません。時間をおいてお試しください。'); }
  let user;
  try {
    const auth = await client.auth.getUser();
    if (auth.error && !isAuthSessionMissing(auth.error)) return authError(503, 'UNAVAILABLE', '注文状況を確認できません。時間をおいてお試しください。');
    user = auth.data.user;
  } catch { return authError(503, 'UNAVAILABLE', '注文状況を確認できません。時間をおいてお試しください。'); }
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  try {
    const row = await readOwnedOrderStatus(client, user.id, orderId.data);
    if (!row) return authError(404, 'NOT_FOUND', '注文が見つかりません。');
    const state = OrderStateSchema.safeParse(row.status);
    if (!state.success) return authError(503, 'UNAVAILABLE', '注文状況を確認できません。時間をおいてお試しください。');
    const description = describeOrderState(state.data);
    return authSuccess({ status: state.data, guidance: description.guidance, retryEligible: description.retryEligible });
  } catch { return authError(503, 'UNAVAILABLE', '注文状況を確認できません。時間をおいてお試しください。'); }
}
