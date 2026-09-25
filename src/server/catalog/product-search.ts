import { SearchQuerySchema, type SearchQuery } from '../../lib/schemas';

export const PRODUCTS_PER_PAGE = 24;

export type ProductSearchItem = {
  id: string; slug: string; sku: string; name: string; brand: string; category: string;
  description: string; beginnerNote: string; priceYen: number;
  images: Array<{ path: string; altText: string }>;
  useCases: string[];
  specifications: Record<string, string | number | boolean | string[]> | null;
};
export type ProductSearchResult = { items: ProductSearchItem[]; total: number; page: number; pageSize: 24 };
export type SearchProductsOptions = {
  fetcher?: typeof fetch;
  env?: Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'>;
};

function normalizeKeyword(value: string | undefined): string | null {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return normalized || null;
}

export function parseProductSearch(input: Record<string, unknown>): SearchQuery {
  return SearchQuerySchema.parse(input);
}

/** Calls the invoker-rights Postgres search function with only validated parameters. */
export async function searchProducts(query: SearchQuery, options: SearchProductsOptions = {}): Promise<ProductSearchResult> {
  const env = options.env ?? process.env;
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase public search configuration is unavailable');

  const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/search_published_products`;
  const response = await (options.fetcher ?? fetch)(url, {
    method: 'POST',
    // Supabase publishable keys identify the public component via apikey; they are not JWTs.
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      search_q: normalizeKeyword(query.q), category_slug: query.category?.trim() || null,
      usage_case: query.usage ?? null, manufacturer: query.manufacturer?.trim() || null,
      min_price: query.minPrice ?? null, max_price: query.maxPrice ?? null,
      min_gpu_clearance_mm: query.minGpuClearanceMm ?? null,
      spec_filter: query.spec ?? {}, sort_order: query.sort ?? 'newest', page_number: query.page ?? 1,
    }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Public product search failed with status ${response.status}`);

  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Public product search returned an invalid response');
  const row = rows[0] as { items?: unknown; total?: unknown; page?: unknown };
  if (!Array.isArray(row.items) || !Number.isSafeInteger(row.total) || !Number.isInteger(row.page)) {
    throw new Error('Public product search returned an invalid response');
  }
  return { items: row.items as ProductSearchItem[], total: row.total as number, page: row.page as number, pageSize: PRODUCTS_PER_PAGE };
}
