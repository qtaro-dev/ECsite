import { NextRequest } from 'next/server';
import { AddressPatchSchema, AddressSchema } from '@/lib/schemas';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { ADDRESS_SELECT, toAddress, type AddressRow } from '@/server/account/addresses';

export async function GET() {
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }
  const { data: { user }, error: authFailure } = await supabase.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  const { data, error } = await supabase.from('addresses').select(ADDRESS_SELECT).order('is_default', { ascending: false }).order('created_at', { ascending: false });
  if (error) return authError(503, 'UNAVAILABLE', '配送先を読み込めませんでした。時間をおいて再度お試しください。');
  return authSuccess((data as AddressRow[]).map(toAddress));
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AddressSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }
  const { data: { user }, error: authFailure } = await supabase.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  const value = parsed.data;
  const { data, error } = await supabase.from('addresses').insert({
    user_id: user.id, recipient_name: value.recipientName, postal_code: value.postalCode,
    prefecture_code: value.prefectureCode, city: value.city, street: value.street,
    building: value.building ?? null, is_default: value.isDefault,
  }).select(ADDRESS_SELECT).single();
  if (error) return authError(error.code === '23505' ? 409 : 503, error.code === '23505' ? 'CONFLICT' : 'UNAVAILABLE', error.code === '23505' ? '既定配送先を保存できませんでした。再読み込みしてお試しください。' : '配送先を保存できませんでした。時間をおいて再度お試しください。');
  return authSuccess(toAddress(data as AddressRow), 201);
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = AddressPatchSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);
  let supabase;
  try { supabase = await createSupabaseServerClient(); } catch { return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。'); }
  const { data: { user }, error: authFailure } = await supabase.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', '現在サービスを利用できません。時間をおいて再度お試しください。');
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
  const { addressId, ...input } = parsed.data;
  const columns = { recipientName: 'recipient_name', postalCode: 'postal_code', prefectureCode: 'prefecture_code', city: 'city', street: 'street', building: 'building', isDefault: 'is_default' } as const;
  const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [columns[key as keyof typeof columns], value]));
  const { data, error } = await supabase.from('addresses').update(values).eq('id', addressId).select(ADDRESS_SELECT).maybeSingle();
  if (error) return authError(error.code === '23505' ? 409 : 503, error.code === '23505' ? 'CONFLICT' : 'UNAVAILABLE', error.code === '23505' ? '既定配送先を保存できませんでした。再読み込みしてお試しください。' : '配送先を保存できませんでした。時間をおいて再度お試しください。');
  if (!data) return authError(404, 'NOT_FOUND', '配送先が見つかりません。');
  return authSuccess(toAddress(data as AddressRow));
}
