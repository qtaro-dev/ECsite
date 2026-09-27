import { NextRequest, NextResponse } from 'next/server';
import { CheckoutStartRequestSchema } from '@/lib/checkout-start-schemas';
import { IdSchema } from '@/lib/schemas';
import { authError, authSuccess, authValidationError, requestId, sameOrigin } from '@/server/auth/http';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isAuthSessionMissing } from '@/server/auth/session-error';
import { CartApiError, getCart } from '@/server/cart/cart-api';
import { createCartServiceClient } from '@/server/cart/service-client';
import { buildCheckoutOrderSnapshot, allocateCheckoutOrder, CheckoutAllocationError } from '@/server/checkout/order-allocation';
import { calculateCheckoutQuote } from '@/server/checkout/quote-calculation';
import { CheckoutQuoteSourceError, loadCheckoutQuoteSource } from '@/server/checkout/quote-source';
import { getStripeCheckoutGateway } from '@/server/checkout/stripe-client';
import { startStripeSession } from '@/server/checkout/start-stripe-session';

const unavailableMessage = '現在決済を開始できません。内容を確認し、時間をおいて再度お試しください。';
const conflictMessages = {
  QUOTE_EXPIRED: '見積の有効期限が切れました。最新の金額で見積し直してください。',
  QUOTE_CHANGED: '価格、送料、税額または商品内容が更新されています。差額を確認して新しい見積を作成してください。',
  STOCK_UNAVAILABLE: '在庫が不足しています。カートの数量を見直してください。',
  PRODUCT_UNAVAILABLE: '販売できない商品があります。カートを確認してください。',
  CART_CHANGED: 'カートの内容が更新されています。カートを確認してください。',
  ADDRESS_CHANGED: '配送先を確認し、新しい見積を作成してください。',
  CHECKOUT_KEY_CONFLICT: '購入操作の識別情報が一致しません。新しい見積からやり直してください。',
} as const;
type ConflictCode = keyof typeof conflictMessages;
type ConflictAction = 'create_new_quote' | 'review_cart' | 'select_address';

function conflict(code: ConflictCode, nextAction: ConflictAction, differences: unknown[] = []) {
  return NextResponse.json({ error: { code, message: conflictMessages[code], nextAction, differences }, requestId: requestId() }, {
    status: 409, headers: { 'Cache-Control': 'no-store' },
  });
}

async function loadPendingCheckout(serviceClient: ReturnType<typeof createCartServiceClient>, userId: string, orderId: string) {
  const { data: order, error: orderError } = await serviceClient.from('orders')
    .select('id,user_id,checkout_key,checkout_quote_id,status,grand_total_yen')
    .eq('id', orderId).eq('user_id', userId).maybeSingle();
  if (orderError || !order) return null;
  const { data: attempt, error: attemptError } = await serviceClient.from('payment_attempts')
    .select('id,state,amount_yen,expires_at').eq('order_id', order.id).eq('attempt_no', 1).maybeSingle();
  if (attemptError || !attempt || attempt.amount_yen !== order.grand_total_yen) return null;
  return { order, attempt };
}

async function sessionResponse(input: {
  stripe: Awaited<ReturnType<typeof getStripeCheckoutGateway>>;
  serviceClient: ReturnType<typeof createCartServiceClient>;
  orderId: string;
  attemptId: string;
  amountYen: number;
  expiresAt: string;
  idempotencyKey: string;
  request: NextRequest;
}) {
  const result = await startStripeSession({
    stripe: input.stripe,
    serviceClient: input.serviceClient,
    orderId: input.orderId,
    attemptId: input.attemptId,
    amountYen: input.amountYen,
    allocationExpiresAt: input.expiresAt,
    idempotencyKey: input.idempotencyKey,
    siteOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? new URL(input.request.url).origin,
  });
  if (result.ok) return authSuccess({ orderId: input.orderId, checkoutUrl: result.session.url });
  if (result.reason === 'allocation_window_elapsed' || result.reason === 'session_expired') return conflict('QUOTE_EXPIRED', 'create_new_quote');
  return authError(503, 'UNAVAILABLE', unavailableMessage);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return authError(403, 'FORBIDDEN', 'この操作を実行する権限がありません。');
  let body: unknown;
  try { body = await request.json(); } catch { return authError(400, 'BAD_REQUEST', '入力内容を確認してください。'); }
  const parsed = CheckoutStartRequestSchema.safeParse(body);
  if (!parsed.success) return authValidationError(parsed.error);
  const checkoutKey = IdSchema.safeParse(request.headers.get('idempotency-key'));
  if (!checkoutKey.success) return authError(400, 'BAD_REQUEST', '購入操作の識別情報を確認してください。');

  let memberClient;
  try { memberClient = await createSupabaseServerClient(); }
  catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  let user;
  try {
    const auth = await memberClient.auth.getUser();
    if (auth.error && !isAuthSessionMissing(auth.error)) return authError(503, 'UNAVAILABLE', unavailableMessage);
    user = auth.data.user;
  } catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  if (!user) return authError(401, 'UNAUTHORIZED', 'ログインしてください。');

  // Check Stripe configuration before creating an order or inventory hold.
  let stripe;
  try { stripe = await getStripeCheckoutGateway(); }
  catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }

  let serviceClient;
  try { serviceClient = createCartServiceClient(); }
  catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }

  // Recover an uncertain Stripe or DB response by the stable checkout key
  // before requiring a still-live quote or rereading mutable cart data.
  let replayOrder;
  try {
    const result = await serviceClient.from('orders').select('id,user_id,checkout_key,checkout_quote_id,status,grand_total_yen')
      .eq('checkout_key', checkoutKey.data).eq('user_id', user.id).maybeSingle();
    if (result.error) return authError(503, 'UNAVAILABLE', unavailableMessage);
    replayOrder = result.data;
  } catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  if (replayOrder) {
    if (replayOrder.checkout_quote_id !== parsed.data.quoteId) return conflict('CHECKOUT_KEY_CONFLICT', 'create_new_quote');
    if (replayOrder.status !== 'payment_pending') return conflict('QUOTE_EXPIRED', 'create_new_quote');
    const pending = await loadPendingCheckout(serviceClient, user.id, replayOrder.id);
    if (!pending) return authError(503, 'UNAVAILABLE', unavailableMessage);
    if (!['created', 'processing'].includes(pending.attempt.state) || Date.parse(pending.attempt.expires_at) <= Date.now()) {
      return conflict('QUOTE_EXPIRED', 'create_new_quote');
    }
    return sessionResponse({
      stripe, serviceClient, orderId: replayOrder.id, attemptId: pending.attempt.id,
      amountYen: pending.attempt.amount_yen, expiresAt: pending.attempt.expires_at,
      idempotencyKey: replayOrder.checkout_key, request,
    });
  }

  let quoteResult;
  try {
    quoteResult = await serviceClient.from('checkout_quotes')
      .select('id,user_id,address_id,items_snapshot,goods_total_yen,shipping_base_yen,shipping_heavy_yen,tax_total_yen,grand_total_yen,shipping_settings_version,expires_at')
      .eq('id', parsed.data.quoteId).eq('user_id', user.id).maybeSingle();
  } catch { return authError(503, 'UNAVAILABLE', unavailableMessage); }
  if (quoteResult.error) return authError(503, 'UNAVAILABLE', unavailableMessage);
  if (!quoteResult.data) return authError(404, 'NOT_FOUND', '見積が見つかりません。最新の見積を作成してください。');
  const savedQuote = quoteResult.data;
  if (Date.parse(savedQuote.expires_at) <= Date.now()) return conflict('QUOTE_EXPIRED', 'create_new_quote');

  let cart;
  try { cart = await getCart(memberClient, null); }
  catch (error) {
    if (error instanceof CartApiError && error.code === 'UNAUTHORIZED') return authError(401, 'UNAUTHORIZED', 'ログインしてください。');
    if (error instanceof CartApiError && error.code === 'CONFLICT') return conflict('CART_CHANGED', 'review_cart');
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }
  let source;
  try { source = await loadCheckoutQuoteSource(user.id, savedQuote.address_id, cart); }
  catch (error) {
    if (error instanceof CheckoutQuoteSourceError && error.code === 'ADDRESS_NOT_FOUND') return conflict('ADDRESS_CHANGED', 'select_address');
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }
  const calculation = calculateCheckoutQuote({ ...source, cart });
  if (!calculation.ok) {
    if (calculation.failure.kind === 'cart_empty') return conflict('CART_CHANGED', 'review_cart');
    if (calculation.failure.kind === 'product_unavailable') {
      return conflict('PRODUCT_UNAVAILABLE', 'review_cart', calculation.failure.productIds.map((productId) => ({ field: 'availability', productId })));
    }
    if (calculation.failure.kind === 'stock_unavailable') {
      return conflict('STOCK_UNAVAILABLE', 'review_cart', calculation.failure.items.map((item) => ({ field: 'stock', ...item })));
    }
    return authError(503, 'UNAVAILABLE', '配送条件または料金表を確認できないため、注文を開始できません。');
  }
  let allocation;
  try {
    const snapshot = buildCheckoutOrderSnapshot(calculation.quote, source.products);
    allocation = await allocateCheckoutOrder({ serviceClient, userId: user.id, quoteId: savedQuote.id, checkoutKey: checkoutKey.data, snapshot });
  } catch (error) {
    if (error instanceof CheckoutAllocationError && error.code === 'INVALID_RESPONSE') return authError(503, 'UNAVAILABLE', unavailableMessage);
    return authError(503, 'UNAVAILABLE', unavailableMessage);
  }
  if (allocation.status === 'not_found') return authError(404, 'NOT_FOUND', '見積が見つかりません。最新の見積を作成してください。');
  if (allocation.status === 'quote_expired') return conflict('QUOTE_EXPIRED', 'create_new_quote');
  if (allocation.status === 'quote_changed' || allocation.status === 'snapshot_stale') return conflict('QUOTE_CHANGED', 'create_new_quote', allocation.differences);
  if (allocation.status === 'stock_unavailable') return conflict('STOCK_UNAVAILABLE', 'review_cart', allocation.items.map((item) => ({ field: 'stock', ...item })));
  if (allocation.status === 'cart_changed') return conflict('CART_CHANGED', 'review_cart');
  if (allocation.status === 'address_changed' || allocation.status === 'address_unavailable') return conflict('ADDRESS_CHANGED', 'select_address');
  if (allocation.status === 'product_unavailable') return conflict('PRODUCT_UNAVAILABLE', 'review_cart', allocation.productId ? [{ field: 'availability', productId: allocation.productId }] : []);
  if (allocation.status === 'key_conflict') return conflict('CHECKOUT_KEY_CONFLICT', 'create_new_quote');
  if (allocation.status === 'shipping_unavailable') return authError(503, 'UNAVAILABLE', '送料を確定できないため、注文を開始できません。');
  if (allocation.status !== 'created' && allocation.status !== 'already_created') return authError(503, 'UNAVAILABLE', unavailableMessage);
  if (allocation.attemptId === null || allocation.amountYen !== calculation.quote.grandTotalYen) return authError(503, 'UNAVAILABLE', unavailableMessage);
  const pending = await loadPendingCheckout(serviceClient, user.id, allocation.orderId);
  if (!pending) return authError(503, 'UNAVAILABLE', unavailableMessage);
  if (!['created', 'processing'].includes(pending.attempt.state) || Date.parse(pending.attempt.expires_at) <= Date.now()) return conflict('QUOTE_EXPIRED', 'create_new_quote');
  return sessionResponse({
    stripe, serviceClient, orderId: allocation.orderId, attemptId: pending.attempt.id,
    amountYen: pending.attempt.amount_yen, expiresAt: pending.attempt.expires_at,
    idempotencyKey: allocation.checkoutKey, request,
  });
}
