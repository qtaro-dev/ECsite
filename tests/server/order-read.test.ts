import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
import { listOwnedOrders, readOwnedOrderDetail, readOwnedOrderStatus } from '../../src/server/orders/order-read';
import type { SupabaseClient } from '@supabase/supabase-js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const orderId = '00000000-0000-4000-8000-000000000002';
function client(rows: Record<string, unknown>) {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    value: { from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((field: string, value: unknown) => { calls.push([table, field, value]); return query; }),
        order: vi.fn(() => query), range: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: rows[table] ?? null, error: null })),
        then(resolve: (value: unknown) => void) { resolve({ data: rows[table] ?? [], error: null }); },
      };
      return query;
    }) } as unknown as SupabaseClient,
  };
}

describe('owner-scoped order reads', () => {
  it('uses both order ID and user ID for status and detail', async () => {
    const source = client({ orders: null });
    expect(await readOwnedOrderStatus(source.value, ownerId, orderId)).toBeNull();
    expect(await readOwnedOrderDetail(source.value, ownerId, orderId)).toBeNull();
    expect(source.calls).toContainEqual(['orders', 'user_id', ownerId]);
    expect(source.calls).toContainEqual(['orders', 'id', orderId]);
    expect(source.calls.every(([table]) => table === 'orders')).toBe(true);
  });
  it('reads the newest owner orders, preserving recorded totals', async () => {
    const row = { id: orderId, status: 'paid', created_at: '2026-09-28T01:00:00Z', grand_total_yen: 12000 };
    const source = client({ orders: [row] });
    expect(await listOwnedOrders(source.value, ownerId)).toEqual({ orders: [row], hasNext: false });
    expect(source.calls).toContainEqual(['orders', 'user_id', ownerId]);
  });
  it('renders order-time item/address snapshots without reading live products or addresses', async () => {
    const order = {
      id: orderId, status: 'paid', created_at: '2026-09-28T01:00:00Z', grand_total_yen: 12000,
      goods_total_yen: 12000, shipping_base_yen: 0, shipping_heavy_yen: 0, shipping_total_yen: 0,
      tax_total_yen: 1090, shipping_rule_version: 'v1',
      address_snapshot: { recipientName: '架空受取人', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '架空1-1', building: null },
    };
    const item = { id: '00000000-0000-4000-8000-000000000003', sku_snapshot: 'OLD-SKU', name_snapshot: '注文時の商品', brand_snapshot: '旧ブランド', unit_price_yen: 12000, quantity: 1, line_total_yen: 12000 };
    const source = client({ orders: order, order_items: [item] });
    expect(await readOwnedOrderDetail(source.value, ownerId, orderId)).toEqual({ order, items: [item] });
    expect(source.calls).toContainEqual(['order_items', 'order_id', orderId]);
    expect(source.value.from).not.toHaveBeenCalledWith('products');
    expect(source.value.from).not.toHaveBeenCalledWith('addresses');
  });
});
