import 'server-only';

export async function getPublishedPrebuiltPartLinks(prebuiltProductId: string): Promise<Record<string, string>> {
  try {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase public catalog configuration is unavailable');
  const base = `${baseUrl.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: anonKey };
  const refsUrl = new URL(`${base}/prebuilt_pc_component_parts`);
  refsUrl.searchParams.set('prebuilt_product_id', `eq.${prebuiltProductId}`);
  refsUrl.searchParams.set('select', 'slot,part_product_id');
  const refsResponse = await fetch(refsUrl, { headers, cache: 'no-store' });
  if (!refsResponse.ok) throw new Error('Prebuilt part references unavailable');
  const refs = await refsResponse.json() as Array<{ slot: string; part_product_id: string }>;
  if (!refs.length) return {};
  const ids = refs.map((ref) => ref.part_product_id);
  const productsUrl = new URL(`${base}/products`);
  productsUrl.searchParams.set('id', `in.(${ids.join(',')})`);
  productsUrl.searchParams.set('select', 'id,slug');
  const productsResponse = await fetch(productsUrl, { headers, cache: 'no-store' });
  if (!productsResponse.ok) throw new Error('Selected parts unavailable');
  const products = await productsResponse.json() as Array<{ id: string; slug: string }>;
  const slugs = new Map(products.map((product) => [product.id, product.slug]));
  return Object.fromEntries(refs.flatMap((ref) => {
    const slug = slugs.get(ref.part_product_id);
    return slug ? [[ref.slot, slug]] : [];
  }));
  } catch {
    // Related catalog links are optional; the PC snapshot and purchase must remain available.
    return {};
  }
}
