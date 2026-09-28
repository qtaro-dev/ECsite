import { NextRequest } from 'next/server';
import { DemoRegionSchema, demoAddress } from '@/lib/demo-address';
import { isDemoUser } from '@/lib/demo-auth';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { createCartServiceClient } from '@/server/cart/service-client';
import { ADDRESS_SELECT, toAddress, type AddressRow } from '@/server/account/addresses';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '地域を選び直してください。'); }
  const parsed = DemoRegionSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);
  let memberClient;
  try { memberClient = await createSupabaseServerClient(); }
  catch { return authError(503, 'UNAVAILABLE', 'デモ配送先を用意できませんでした。時間をおいて再試行してください。'); }
  const { data: { user }, error: authFailure } = await memberClient.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '認証状態を確認できませんでした。再試行してください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'デモ会員を開始してください。');
  if (!isDemoUser(user)) return authError(403, 'FORBIDDEN', '通常会員は配送先を登録してください。');

  let serviceClient;
  try { serviceClient = createCartServiceClient(); }
  catch { return authError(503, 'UNAVAILABLE', 'デモ配送先を用意できませんでした。時間をおいて再試行してください。'); }
  const fixed = demoAddress(parsed.data.prefectureCode);
  const findExisting = () => serviceClient.from('addresses').select(ADDRESS_SELECT)
    .eq('user_id', user.id).eq('prefecture_code', fixed.prefectureCode)
    .eq('recipient_name', fixed.recipientName).eq('postal_code', fixed.postalCode)
    .eq('city', fixed.city).eq('street', fixed.street).is('building', null)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  const existing = await findExisting();
  if (existing.error) return authError(503, 'UNAVAILABLE', 'デモ配送先を読み込めませんでした。再試行してください。');
  if (existing.data) return authSuccess(toAddress(existing.data as AddressRow));
  const { data, error } = await serviceClient.from('addresses').insert({
    user_id: user.id, recipient_name: fixed.recipientName, postal_code: fixed.postalCode,
    prefecture_code: fixed.prefectureCode, city: fixed.city, street: fixed.street,
    building: fixed.building, is_default: fixed.isDefault,
  }).select(ADDRESS_SELECT).single();
  if (error?.code === '23505') {
    const concurrentlyCreated = await findExisting();
    if (!concurrentlyCreated.error && concurrentlyCreated.data) return authSuccess(toAddress(concurrentlyCreated.data as AddressRow));
  }
  if (error || !data) return authError(503, 'UNAVAILABLE', 'デモ配送先を保存できませんでした。再試行してください。');
  return authSuccess(toAddress(data as AddressRow), 201);
}
