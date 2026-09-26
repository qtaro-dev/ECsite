import 'server-only';
import { AdminProductDetailSchema, AdminProductListSchema } from '@/lib/admin-product-schemas';
import { IdSchema } from '@/lib/schemas';
import { createAdminDataClient } from '@/server/admin/overview';

export async function getAdminProducts(query = '') {
  const client = createAdminDataClient();
  const search = query.trim();
  const escaped = search.replace(/[\\%_(),]/g, '\\$&');
  let productQuery = client.from('products')
    .select('id,slug,sku,name,brand,status,price_tax_included_yen,version,updated_at,categories!inner(slug)')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (escaped) {
    const pattern = `%${escaped}%`;
    productQuery = productQuery.or(`name.ilike.${pattern},brand.ilike.${pattern},slug.ilike.${pattern},sku.ilike.${pattern}`);
  }
  const { data, error } = await productQuery;
  if (error) throw new Error('Admin product query failed');
  const items = (data ?? []).map((row) => {
    const category = row.categories as unknown as { slug: string };
    return {
      id: row.id,
      category: category.slug,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      brand: row.brand,
      status: row.status,
      priceTaxIncludedYen: row.price_tax_included_yen,
      version: row.version,
      updatedAt: row.updated_at,
    };
  });
  return AdminProductListSchema.parse(items);
}

const specificationTable: Record<string, string> = {
  cpu: 'cpu_specs', gpu: 'gpu_specs', motherboard: 'motherboard_specs', memory: 'memory_specs',
  ssd: 'ssd_specs', 'power-supply': 'psu_specs', 'pc-case': 'case_specs', 'cpu-cooler': 'cooler_specs',
};

export async function getAdminProduct(productId: string) {
  if (!IdSchema.safeParse(productId).success) return null;
  const client = createAdminDataClient();
  const { data: row, error } = await client.from('products')
    .select('id,slug,sku,name,brand,description,beginner_note,price_tax_included_yen,status,weight_g,pack_length_mm,pack_width_mm,pack_height_mm,version,updated_at,categories!inner(slug)')
    .eq('id', productId).is('deleted_at', null).maybeSingle();
  if (error || !row) return null;
  const category = row.categories as unknown as { slug: string };
  const specTable = specificationTable[category.slug];
  if (!specTable) return null;
  const [{ data: specRow, error: specError }, { data: useCaseRows, error: useCaseError }, { data: imageRows, error: imageError }] = await Promise.all([
    client.from(specTable).select('*').eq('product_id', productId).maybeSingle(),
    client.from('product_use_cases').select('use_case').eq('product_id', productId),
    client.from('product_images').select('storage_path,alt_text').eq('product_id', productId).order('sort_order'),
  ]);
  if (specError || useCaseError || imageError) throw new Error('Admin product details query failed');
  const specifications = { ...(specRow as Record<string, unknown> | null) };
  delete specifications.product_id;
  return AdminProductDetailSchema.parse({
    id: row.id,
    version: row.version,
    updatedAt: row.updated_at,
    category: category.slug,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    brand: row.brand,
    description: row.description,
    beginnerNote: row.beginner_note,
    priceTaxIncludedYen: row.price_tax_included_yen,
    status: row.status,
    weightG: row.weight_g,
    packLengthMm: row.pack_length_mm,
    packWidthMm: row.pack_width_mm,
    packHeightMm: row.pack_height_mm,
    useCases: (useCaseRows ?? []).map((item) => item.use_case),
    specifications,
    images: (imageRows ?? []).map((image) => ({ storagePath: image.storage_path, altText: image.alt_text })),
  });
}
