import { z } from 'zod';
import { IdSchema, YenSchema } from './schemas';

export const OrderStateSchema = z.enum(['payment_pending', 'paid', 'payment_failed', 'expired', 'review_required']);
export const CheckoutStatusResultSchema = z.object({
  status: OrderStateSchema,
  guidance: z.string().min(1),
  retryEligible: z.boolean(),
}).strict();
export const OrderSummarySchema = z.object({
  id: IdSchema, status: OrderStateSchema, created_at: z.string(), grand_total_yen: YenSchema,
}).strict();
export const OrderDetailSchema = OrderSummarySchema.extend({
  goods_total_yen: YenSchema, shipping_base_yen: YenSchema, shipping_heavy_yen: YenSchema,
  shipping_total_yen: YenSchema, tax_total_yen: YenSchema, shipping_rule_version: z.string(),
  address_snapshot: z.object({
    recipientName: z.string(), postalCode: z.string(), prefectureCode: z.number().int(),
    city: z.string(), street: z.string(), building: z.string().nullable().optional(),
  }).passthrough(),
}).strict();
export const OrderItemSchema = z.object({
  id: IdSchema, sku_snapshot: z.string(), name_snapshot: z.string(), brand_snapshot: z.string(),
  unit_price_yen: YenSchema, quantity: z.number().int().positive(), line_total_yen: YenSchema,
}).strict();

export type OrderState = z.infer<typeof OrderStateSchema>;

/** Only the database state determines success. A Stripe return URL is never evidence of payment. */
export function describeOrderState(status: OrderState) {
  switch (status) {
    case 'paid': return { title: 'テスト決済が完了しました', guidance: '注文内容を注文履歴で確認できます。実際の課金・発送はありません。', retryEligible: false, kind: 'success' as const };
    case 'payment_failed': return { title: 'テスト決済を完了できませんでした', guidance: '決済に失敗しました。カートの商品と在庫を確認し、新しい見積から再度お試しください。', retryEligible: true, kind: 'error' as const };
    case 'expired': return { title: '決済の期限が切れました', guidance: 'この注文の決済期限が切れました。カートの商品と在庫を確認し、新しい見積から再度お試しください。', retryEligible: true, kind: 'warning' as const };
    case 'review_required': return { title: '決済状況を確認しています', guidance: '決済結果を安全に確定できていません。重複決済を避けるため、再注文せずに時間をおいて注文履歴を確認してください。', retryEligible: false, kind: 'warning' as const };
    case 'payment_pending': return { title: '決済結果を確認中です', guidance: '決済通知の反映を待っています。少し待ってから最新の状態を確認してください。', retryEligible: false, kind: 'info' as const };
  }
}
