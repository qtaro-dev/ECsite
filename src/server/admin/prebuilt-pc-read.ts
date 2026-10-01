import 'server-only';
import { AdminPrebuiltPcDetailSchema } from '@/lib/admin-prebuilt-pc-schemas';
import { createAdminDataClient } from '@/server/admin/overview';

export async function getAdminPrebuiltPc(productId: string) {
  const client = createAdminDataClient();
  const { data: row, error } = await client.from('products')
    .select('id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,version,updated_at,categories!inner(slug)')
    .eq('id', productId).is('deleted_at', null).maybeSingle();
  if (error || !row || (row.categories as unknown as { slug: string }).slug !== 'prebuilt-pc') return null;
  const [{ data: spec, error: specError }, { data: refs, error: refsError }, { data: useCases, error: useCaseError }, { data: images, error: imageError }] = await Promise.all([
    client.from('prebuilt_pc_specs').select('components').eq('product_id', productId).maybeSingle(),
    client.from('prebuilt_pc_component_parts').select('slot,part_product_id').eq('prebuilt_product_id', productId),
    client.from('product_use_cases').select('use_case').eq('product_id', productId),
    client.from('product_images').select('storage_path,alt_text,sort_order').eq('product_id', productId).order('sort_order'),
  ]);
  if (specError || refsError || useCaseError || imageError) throw new Error('Prebuilt PC detail unavailable');
  const partIds = (refs ?? []).length ? Object.fromEntries((refs ?? []).map((entry) => [entry.slot, entry.part_product_id])) : null;
  return AdminPrebuiltPcDetailSchema.parse({
    id: row.id, version: row.version, updatedAt: row.updated_at, slug: row.slug, sku: row.sku,
    name: row.name, brand: row.brand, description: row.description, beginnerNote: row.beginner_note,
    priceTaxIncludedYen: row.price_tax_included_yen, status: row.status,
    weightG: row.weight_g, packLengthMm: row.pack_length_mm, packWidthMm: row.pack_width_mm, packHeightMm: row.pack_height_mm,
    useCases: (useCases ?? []).map((entry) => entry.use_case), components: (spec?.components as never) ?? null,
    partIds, legacyComponents: Boolean(spec && !partIds),
    images: (images ?? []).map((entry) => ({ storagePath: entry.storage_path, altText: entry.alt_text, sortOrder: entry.sort_order })),
  });
}
