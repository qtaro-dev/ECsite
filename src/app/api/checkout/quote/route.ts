import { NextRequest, NextResponse } from 'next/server';
import { CheckoutQuoteRequestSchema, CheckoutQuoteResultSchema } from '@/lib/checkout-quote-schemas';
import { authError, authSuccess, authValidationError, requestId, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { getCart, CartApiError } from '@/server/cart/cart-api';
import { createCartServiceClient } from '@/server/cart/service-client';
import { CheckoutQuoteSourceError, loadCheckoutQuoteSource } from '@/server/checkout/quote-source';
import { calculateCheckoutQuote } from '@/server/checkout/quote-calculation';

const message = '現在サービスを利用できません。時間をおいて再度お試しください。';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = CheckoutQuoteRequestSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  let memberClient;
  try { memberClient = await createSupabaseServerClient(); }
  catch { return authError(503, 'UNAVAILABLE', message); }
  const { data: { user }, error: authFailure } = await memberClient.auth.getUser();
  if (authFailure && !isAuthSessionMissing(authFailure)) return authError(503, 'UNAVAILABLE', message);
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');

  let serviceClient;
  try { serviceClient = createCartServiceClient(); } catch { return authError(503, 'UNAVAILABLE', message); }
  const { data: rateData, error: rateError } = await serviceClient.rpc('checkout_quote_rate_limit', { p_user_id: user.id });
  if (rateError) return authError(503, 'UNAVAILABLE', message);
  const rateState = Array.isArray(rateData) ? rateData[0] : rateData;
  if (!rateState || typeof rateState !== 'object' || typeof rateState.allowed !== 'boolean') return authError(503, 'UNAVAILABLE', message);
  if (!rateState.allowed) {
    const retryAfter = Number.isSafeInteger(rateState.retry_after_seconds) && rateState.retry_after_seconds > 0 ? rateState.retry_after_seconds : 60;
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: '見積の作成回数が上限に達しました。少し待ってから再度お試しください。' }, requestId: requestId() }, {
      status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) },
    });
  }

  let cart;
  try { cart = await getCart(memberClient, null); }
  catch (error) {
    if (error instanceof CartApiError && error.code === 'UNAUTHORIZED') return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
    if (error instanceof CartApiError && error.code === 'CONFLICT') return authError(409, 'CONFLICT', 'カートの商品または数量を確認してください。');
    return authError(503, 'UNAVAILABLE', message);
  }
  if (!cart.items.length) return authError(409, 'CONFLICT', 'カートに商品がありません。商品を追加してから見積してください。');

  let source;
  try { source = await loadCheckoutQuoteSource(user.id, parsed.data.addressId, cart); }
  catch (error) {
    if (error instanceof CheckoutQuoteSourceError && error.code === 'ADDRESS_NOT_FOUND') return authError(404, 'NOT_FOUND', '配送先が見つかりません。配送先を選び直してください。');
    return authError(503, 'UNAVAILABLE', message);
  }
  const calculated = calculateCheckoutQuote({ ...source, cart });
  if (!calculated.ok) {
    const failure = calculated.failure;
    if (failure.kind === 'cart_empty') return authError(409, 'CONFLICT', 'カートに商品がありません。商品を追加してから見積してください。');
    if (failure.kind === 'product_unavailable') return authError(409, 'CONFLICT', '販売を終了した商品があります。カートを更新してから再度お試しください。');
    if (failure.kind === 'stock_unavailable') return authError(409, 'CONFLICT', '在庫が不足している商品があります。数量を見直してから再度お試しください。');
    if (failure.kind === 'shipping_unavailable') return authError(503, 'UNAVAILABLE', '配送条件または料金表を確認できないため、正式な送料を計算できません。配送設定が整うまで購入手続きを進められません。');
    return authError(503, 'UNAVAILABLE', message);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const quote = calculated.quote;
  // Expired quotes are only retained for their authorized 15 minute lifetime.
  const { error: expiredDeleteError } = await serviceClient.from('checkout_quotes').delete().lt('expires_at', now.toISOString());
  if (expiredDeleteError) return authError(503, 'UNAVAILABLE', message);
  const { data: saved, error: saveError } = await serviceClient.from('checkout_quotes').insert({
    user_id: user.id,
    address_id: parsed.data.addressId,
    items_snapshot: quote.items.map(({ productId, quantity, unitPriceYen, lineTotalYen }) => ({ productId, quantity, unitPriceYen, lineTotalYen })),
    goods_total_yen: quote.goodsTotalYen,
    shipping_base_yen: quote.shipping.baseYen,
    shipping_heavy_yen: quote.shipping.heavyYen,
    tax_total_yen: quote.taxTotalYen,
    grand_total_yen: quote.grandTotalYen,
    shipping_settings_version: quote.shippingSettingsVersion,
    expires_at: expiresAt,
  }).select('id').single();
  if (saveError || !saved) return authError(503, 'UNAVAILABLE', message);

  const response = CheckoutQuoteResultSchema.safeParse({ quoteId: saved.id, expiresAt, ...quote });
  if (!response.success) return authError(503, 'UNAVAILABLE', message);
  return authSuccess(response.data);
}
