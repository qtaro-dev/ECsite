import 'server-only';
import { createAdminDataClient } from '@/server/admin/overview';

export const PART_CATEGORIES = {
  cpu: 'cpu', gpu: 'gpu', memory: 'memory', ssd: 'ssd', motherboard: 'motherboard',
  powerSupply: 'power-supply', pcCase: 'pc-case', cpuCooler: 'cpu-cooler',
} as const;
export type PartSlot = keyof typeof PART_CATEGORIES;

export async function getPrebuiltPartCandidates(slot: PartSlot, search: string, page: number) {
  const client = createAdminDataClient();
  const escaped = search.trim().replace(/[\\%_(),]/g, '\\$&');
  let query = client.from('products')
    .select('id,name,brand,sku,status,categories!inner(slug)', { count: 'exact' })
    .eq('categories.slug', PART_CATEGORIES[slot]).eq('status', 'published').is('deleted_at', null)
    .order('name').order('id').range(page * 20, page * 20 + 19);
  if (escaped) query = query.or(`name.ilike.%${escaped}%,brand.ilike.%${escaped}%,sku.ilike.%${escaped}%`);
  const { data, count, error } = await query;
  if (error) throw new Error('Part candidates unavailable');
  return {
    items: (data ?? []).map((row) => ({ id: row.id, name: row.name, brand: row.brand, sku: row.sku,
      status: row.status, details: [row.brand, `SKU: ${row.sku}`].filter(Boolean).join(' · ') })),
    page, hasMore: (count ?? 0) > (page + 1) * 20,
  };
}
