import type { ProductSearchItem } from './product-search';

export type ProductDetail = ProductSearchItem & { availableQuantity: number };

export type ProductDetailOptions = {
  fetcher?: typeof fetch;
  env?: Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'>;
};

export async function getPublishedProductDetail(slug: string, options: ProductDetailOptions = {}): Promise<ProductDetail | null> {
  const env = options.env ?? process.env;
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase public catalog configuration is unavailable');

  const response = await (options.fetcher ?? fetch)(
    `${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_published_product_detail`,
    {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_slug: slug }),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error(`Published product detail failed with status ${response.status}`);
  const product: unknown = await response.json();
  if (product === null) return null;
  if (typeof product !== 'object' || !('slug' in product) || !('availableQuantity' in product)) {
    throw new Error('Published product detail returned an invalid response');
  }
  return product as ProductDetail;
}

export function productImageUrl(path: string): string {
  return `/api/product-images/${path.split('/').map(encodeURIComponent).join('/')}`;
}
