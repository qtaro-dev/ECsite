import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderDetailSchema, OrderItemSchema, OrderSummarySchema } from '@/lib/order-display';

export class OrderReadError extends Error {
  constructor() { super('ORDER_READ_UNAVAILABLE'); }
}

/** Always constrain by owner even though RLS also enforces ownership. */
export async function readOwnedOrderStatus(client: SupabaseClient, userId: string, orderId: string) {
  let response;
  try {
    response = await client.from('orders').select('id,status').eq('id', orderId).eq('user_id', userId).maybeSingle();
  } catch { throw new OrderReadError(); }
  if (response.error) throw new OrderReadError();
  return response.data;
}

const pageSize = 20;

export async function listOwnedOrders(client: SupabaseClient, userId: string, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) throw new OrderReadError();
  let response;
  try {
    response = await client.from('orders').select('id,status,created_at,grand_total_yen')
      .eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize);
  } catch { throw new OrderReadError(); }
  if (response.error) throw new OrderReadError();
  const parsed = OrderSummarySchema.array().safeParse(response.data);
  if (!parsed.success) throw new OrderReadError();
  return { orders: parsed.data.slice(0, pageSize), hasNext: parsed.data.length > pageSize };
}

export async function readOwnedOrderDetail(client: SupabaseClient, userId: string, orderId: string) {
  let response;
  try {
    response = await client.from('orders').select('id,status,created_at,grand_total_yen,goods_total_yen,shipping_base_yen,shipping_heavy_yen,shipping_total_yen,tax_total_yen,shipping_rule_version,address_snapshot')
      .eq('id', orderId).eq('user_id', userId).maybeSingle();
  } catch { throw new OrderReadError(); }
  if (response.error) throw new OrderReadError();
  if (!response.data) return null;
  const order = OrderDetailSchema.safeParse(response.data);
  if (!order.success) throw new OrderReadError();
  let itemsResponse;
  try {
    itemsResponse = await client.from('order_items').select('id,sku_snapshot,name_snapshot,brand_snapshot,unit_price_yen,quantity,line_total_yen')
      .eq('order_id', orderId).order('id');
  } catch { throw new OrderReadError(); }
  if (itemsResponse.error) throw new OrderReadError();
  const items = OrderItemSchema.array().safeParse(itemsResponse.data);
  if (!items.success) throw new OrderReadError();
  return { order: order.data, items: items.data };
}
