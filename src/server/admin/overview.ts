import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createAdminDataClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Admin dashboard database configuration is unavailable');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type CountResponse = { count: number | null; error: unknown };
type InventoryResponse = { data: Array<{ on_hand: number; allocated: number }> | null; error: unknown };
type PublishedProductCountQuery = PromiseLike<CountResponse> & { is(column: string, value: null): PromiseLike<CountResponse> };
type AdminOverviewClient = {
  from(table: 'products'): {
    select(columns: string, options: { count: 'exact'; head: true }): {
      eq(column: string, value: string): PublishedProductCountQuery;
    };
  };
  from(table: 'notification_jobs'): {
    select(columns: string, options: { count: 'exact'; head: true }): {
      eq(column: string, value: string): PromiseLike<CountResponse>;
    };
  };
  from(table: 'orders'): {
    select(columns: string, options: { count: 'exact'; head: true }): PromiseLike<CountResponse>;
  };
  from(table: 'inventory'): {
    select(columns: string): PromiseLike<InventoryResponse>;
  };
};

export async function getAdminOverview(source: SupabaseClient | AdminOverviewClient) {
  const client = source as unknown as AdminOverviewClient;
  const [products, orders, failedNotifications, inventory] = await Promise.all([
    client.from('products').select('id', { count: 'exact', head: true }).eq('status', 'published').is('deleted_at', null),
    client.from('orders').select('id', { count: 'exact', head: true }),
    client.from('notification_jobs').select('id', { count: 'exact', head: true }).eq('state', 'failed'),
    client.from('inventory').select('on_hand, allocated'),
  ]);
  if (products.error || orders.error || failedNotifications.error || inventory.error) throw new Error('Dashboard data unavailable');
  const inventoryRows: Array<{ on_hand: number; allocated: number }> = inventory.data ?? [];
  return {
    publishedProducts: products.count ?? 0,
    outOfStockProducts: inventoryRows.filter((row) => row.on_hand - row.allocated <= 0).length,
    orders: orders.count ?? 0,
    notificationFailures: failedNotifications.count ?? 0,
  };
}
