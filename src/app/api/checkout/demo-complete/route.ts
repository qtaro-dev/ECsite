import { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { DemoCheckoutRequestSchema, DemoCheckoutRpcResultSchema } from '@/lib/demo-checkout-schemas';
import { isDemoAddress } from '@/lib/demo-address';
import { isDemoUser } from '@/lib/demo-auth';
import { authError, authSuccess, authValidationError, sameOrigin } from '@/server/auth/http';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { CartApiError, getCart } from '@/server/cart/cart-api';
import { createCartServiceClient } from '@/server/cart/service-client';
import { CheckoutQuoteSourceError, loadCheckoutQuoteSource } from '@/server/checkout/quote-source';
import { calculateCheckoutQuote } from '@/server/checkout/quote-calculation';
import { buildCheckoutOrderSnapshot, CheckoutAllocationError } from '@/server/checkout/order-allocation';

const unavailableMessage = 'デモ購入を完了できませんでした。時間をおいて再試行してください。';

function conflict(status: string) {
  const messages: Record<string, string> = {
    quote_expired: '見積の有効期限が切れました。配送先から新しい見積を作成してください。',
    checkout_started: 'この見積はテスト決済の手続きが始まっています。注文内容を確認してください。',
    deletion_pending: 'デモ会員の削除を受け付けています。購入操作はできません。',
    cart_changed: 'カートの内容が更新されています。カートを確認し、新しい見積を作成してください。',
    address_unavailable: '架空配送先を確認できません。地域を選び直してください。',
    address_changed: '配送先の内容が更新されています。地域を選び直し、新しい見積を作成してください。',
    product_unavailable: '販売できない商品があります。カートを確認してください。',
    shipping_unavailable: '送料を確認できません。時間をおいて再試行してください。',
    quote_changed: '価格、送料、税額または商品内容が更新されています。新しい見積を作成してください。',
    stock_unavailable: '在庫が不足しています。カートの数量を見直してください。',
  };
  return authError(409, 'CONFLICT', messages[status] ?? '購入内容が更新されています。カートを確認してください。');
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = DemoCheckoutRequestSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);

  let memberClient;
  try { memberClient = await createSupabaseServerClient(); }
  catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  let user: User | null;
  try {
    const auth = await memberClient.auth.getUser();
    if (auth.error && !isAuthSessionMissing(auth.error)) return authError(503, 'UNAVAILABLE', unavailableMessage);
    user = auth.data.user;
  } catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  if (!user) return authError(401, 'UNAUTHORIZED', 'デモ会員を開始してください。');
  if (!isDemoUser(user)) return authError(403, 'FORBIDDEN', '架空デモ購入はデモ会員のみ利用できます。');
  const memberId = user.id;

  let serviceClient: ReturnType<typeof createCartServiceClient>;
  try { serviceClient = createCartServiceClient(); }
  catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  const quoteResult = await serviceClient.from('checkout_quotes')
    .select('id,user_id,address_id,expires_at,demo_completed_at')
    .eq('id', parsed.data.quoteId).eq('user_id', memberId).maybeSingle();
  if (quoteResult.error) return authError(503, 'UNAVAILABLE', unavailableMessage);
  if (!quoteResult.data) return authError(404, 'NOT_FOUND', '見積が見つかりません。新しい見積を作成してください。');
  if (quoteResult.data.demo_completed_at) return authSuccess({ completed: true, replayed: true });
  if (Date.parse(quoteResult.data.expires_at) <= Date.now()) return conflict('quote_expired');

  let cart;
  try { cart = await getCart(memberClient, null); }
  catch (error) {
    if (error instanceof CartApiError && error.code === 'UNAUTHORIZED') return authError(401, 'UNAUTHORIZED', 'デモ会員を開始してください。');
    if (error instanceof CartApiError && error.code === 'CONFLICT') return conflict('cart_changed');
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }

  // When a competing request has already cleared this cart, ask the row-locked
  // RPC to resolve the replay before returning the empty-cart conflict.
  if (cart.items.length === 0) {
    return completeWithSnapshot(null);
  }

  let source;
  try { source = await loadCheckoutQuoteSource(memberId, quoteResult.data.address_id, cart); }
  catch (error) {
    if (error instanceof CheckoutQuoteSourceError && error.code === 'ADDRESS_NOT_FOUND') return conflict('address_unavailable');
    if (error instanceof CheckoutQuoteSourceError && error.code === 'SHIPPING_UNAVAILABLE') return conflict('shipping_unavailable');
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }
  if (!isDemoAddress(source.address)) return conflict('address_changed');
  const calculation = calculateCheckoutQuote({ ...source, cart });
  if (!calculation.ok) {
    if (calculation.failure.kind === 'cart_empty') return completeWithSnapshot(null);
    if (calculation.failure.kind === 'product_unavailable') return conflict('product_unavailable');
    if (calculation.failure.kind === 'stock_unavailable') return conflict('stock_unavailable');
    return conflict('shipping_unavailable');
  }

  let snapshot;
  try { snapshot = buildCheckoutOrderSnapshot(calculation.quote, source.products); }
  catch (error) {
    if (error instanceof CheckoutAllocationError) return authError(503, 'UNAVAILABLE', unavailableMessage);
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }
  return completeWithSnapshot(snapshot);

  async function completeWithSnapshot(snapshot: unknown) {
    let result;
    try {
      result = await serviceClient.rpc('complete_demo_checkout', {
        p_user_id: memberId, p_quote_id: quoteResult.data!.id, p_current_snapshot: snapshot,
      });
    } catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
    if (result.error) return authError(503, 'UNAVAILABLE', unavailableMessage);
    const response = DemoCheckoutRpcResultSchema.safeParse(result.data);
    if (!response.success) return authError(503, 'UNAVAILABLE', unavailableMessage);
    if (response.data.status === 'completed' || response.data.status === 'already_completed') {
      return authSuccess({ completed: true, replayed: response.data.status === 'already_completed' });
    }
    if (response.data.status === 'not_found') return authError(404, 'NOT_FOUND', '見積が見つかりません。新しい見積を作成してください。');
    return conflict(response.data.status);
  }
}
