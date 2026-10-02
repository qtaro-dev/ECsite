import 'server-only';
import { createAdminDataClient } from '@/server/admin/overview';

export const PART_CATEGORIES = {
  cpu: 'cpu', gpu: 'gpu', memory: 'memory', ssd: 'ssd', motherboard: 'motherboard',
  powerSupply: 'power-supply', pcCase: 'pc-case', cpuCooler: 'cpu-cooler',
} as const;
export type PartSlot = keyof typeof PART_CATEGORIES;

const SPEC_TABLES: Record<PartSlot, string> = {
  cpu: 'cpu_specs', gpu: 'gpu_specs', memory: 'memory_specs', ssd: 'ssd_specs',
  motherboard: 'motherboard_specs', powerSupply: 'psu_specs', pcCase: 'case_specs', cpuCooler: 'cooler_specs',
};
function summary(slot: PartSlot, spec: Record<string, unknown> | undefined, brand: string, sku: string) {
  const value = (key: string, unit = '') => spec?.[key] == null ? '' : `${spec[key]}${unit}`;
  const parts: string[] = slot === 'cpu' ? [value('socket_code'), value('core_count', 'コア')]
    : slot === 'gpu' ? [value('chipset'), value('vram_gb', 'GB')]
      : slot === 'memory' ? [value('ddr_generation'), value('capacity_gb', 'GB'), value('module_count', '枚')]
        : slot === 'ssd' ? [value('capacity_gb', 'GB'), value('interface'), value('form_factor')]
          : slot === 'motherboard' ? [value('socket_code'), value('ddr_generation'), value('form_factor')]
            : slot === 'powerSupply' ? [value('rated_w', 'W'), value('efficiency_grade')]
              : slot === 'pcCase' ? [value('outer_length_mm', 'mm'), value('outer_width_mm', 'mm'), value('outer_height_mm', 'mm')]
                : [value('cooling_type'), value('height_mm', 'mm')];
  return [brand, parts.filter(Boolean).join(' / '), `SKU: ${sku}`].filter(Boolean).join(' · ').slice(0, 300);
}

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
  const ids = (data ?? []).map((row) => row.id);
  const specs = ids.length ? await client.from(SPEC_TABLES[slot]).select('*').in('product_id', ids) : { data: [], error: null };
  if (specs.error) throw new Error('Part specifications unavailable');
  const byId = new Map(((specs.data ?? []) as Record<string, unknown>[]).map((row) => [row.product_id, row]));
  return {
    items: (data ?? []).map((row) => ({ id: row.id, name: row.name, brand: row.brand, sku: row.sku,
      status: row.status, details: summary(slot, byId.get(row.id), row.brand, row.sku) })),
    page, hasMore: (count ?? 0) > (page + 1) * 20,
  };
}
