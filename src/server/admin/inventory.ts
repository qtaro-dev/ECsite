import 'server-only';
import { AdminInventoryResponseSchema, AdminInventoryStateSchema } from '@/lib/admin-inventory-schemas';
import { createAdminDataClient } from '@/server/admin/overview';

export class InventoryAdjustmentError extends Error {
  constructor(readonly status: 'conflict' | 'below_allocated' | 'below_zero' | 'above_maximum' | 'not_found', readonly latest?: unknown) { super(status); }
}

function parseInventoryState(result: Record<string, unknown>) {
  return AdminInventoryStateSchema.parse({
    productId: result.productId,
    onHand: result.onHand,
    allocated: result.allocated,
    available: result.available,
    version: result.version,
  });
}

export async function getAdminInventory(requestedPage = 1) {
  const client = createAdminDataClient();
  const { count, error: countError } = await client.from('products').select('id', { count: 'exact', head: true }).is('deleted_at', null);
  if (countError) throw new Error('Admin inventory count query failed');
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const page = Math.min(requestedPage, totalPages);
  const from = (page - 1) * 50;
  const [{ data: products, error: productError }, { data: adjustments, error: adjustmentError }] = await Promise.all([
    client.from('products').select('id,sku,name,status,categories!inner(slug)').is('deleted_at', null)
      .order('name').order('id').range(from, from + 49),
    client.from('inventory_adjustments').select('id,product_id,delta,reason,created_at,products!inner(name)').order('created_at', { ascending: false }).limit(50),
  ]);
  if (productError || adjustmentError) throw new Error('Admin inventory query failed');
  const productIds = (products ?? []).map((row) => row.id);
  const { data: inventory, error: inventoryError } = productIds.length
    ? await client.from('inventory').select('product_id,on_hand,allocated,version').in('product_id', productIds)
    : { data: [], error: null };
  if (inventoryError) throw new Error('Admin inventory query failed');
  const stockByProduct = new Map((inventory ?? []).map((row) => [row.product_id, row]));
  const items = (products ?? []).map((row) => {
    const category = row.categories as unknown as { slug: string };
    const stock = stockByProduct.get(row.id);
    const onHand = stock?.on_hand ?? 0;
    const allocated = stock?.allocated ?? 0;
    return { productId: row.id, category: category.slug, sku: row.sku, name: row.name, status: row.status,
      onHand, allocated, available: onHand - allocated, version: Number(stock?.version ?? 0) };
  });
  const log = (adjustments ?? []).map((row) => ({
    id: row.id, productId: row.product_id,
    productName: (row.products as unknown as { name: string }).name,
    delta: row.delta, reason: row.reason, createdAt: row.created_at,
  }));
  return AdminInventoryResponseSchema.parse({ items, adjustments: log, page, pageSize: 50, total, totalPages });
}

export async function adjustAdminInventory(input: {
  productId: string; delta: number; reason: string; expectedVersion: number;
}, actorId: string, requestId: string) {
  const client = createAdminDataClient();
  const { data, error } = await client.rpc('admin_adjust_inventory', {
    p_product_id: input.productId, p_delta: input.delta, p_reason: input.reason,
    p_expected_version: input.expectedVersion, p_actor_id: actorId, p_request_id: requestId,
  });
  if (error) throw new Error('Inventory adjustment database operation failed');
  const result = data as Record<string, unknown>;
  if (result.status === 'updated') return {
    state: parseInventoryState(result), adjustmentId: result.adjustmentId,
    auditId: result.auditId, createdAt: result.createdAt,
  };
  if (result.status === 'conflict' || result.status === 'below_allocated' || result.status === 'below_zero' || result.status === 'above_maximum' || result.status === 'not_found') {
    const latest = result.status === 'not_found' ? undefined : parseInventoryState(result);
    throw new InventoryAdjustmentError(result.status, latest);
  }
  throw new Error('Unexpected inventory adjustment result');
}
