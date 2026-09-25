import { describe, expect, it, vi } from 'vitest';
import { parseProductSearch, searchProducts } from '../../src/server/catalog/product-search';

describe('public product search service', () => {
  it('normalizes keyword and sends every validated filter as an AND-search RPC argument', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { items: [], total: 0, page: 2 },
    ])));
    const query = parseProductSearch({
      q: '　RTX   5070　', category: 'gpu', usage: 'gaming', manufacturer: 'Fixture',
      minPrice: '10000', maxPrice: '20000', spec: '{"vram_gb":12}', sort: 'price_asc', page: '2',
    });

    await expect(searchProducts(query, {
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' }, fetcher,
    })).resolves.toEqual({ items: [], total: 0, page: 2, pageSize: 24 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/search_published_products');
    expect(JSON.parse(String(init?.body))).toEqual({
      search_q: 'RTX 5070', category_slug: 'gpu', usage_case: 'gaming', manufacturer: 'Fixture',
      min_price: 10000, max_price: 20000, spec_filter: { vram_gb: 12 }, sort_order: 'price_asc', page_number: 2,
    });
    expect(new Headers(init?.headers).get('apikey')).toBe('public-test-key');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('rejects invalid price bounds and malformed specification filters before fetching', () => {
    expect(() => parseProductSearch({ minPrice: '200', maxPrice: '100' })).toThrow();
    expect(() => parseProductSearch({ spec: '{invalid' })).toThrow();
    expect(() => parseProductSearch({ unknown: 'x' })).toThrow();
  });

  it('maps database and configuration failures to service errors without exposing response bodies', async () => {
    await expect(searchProducts(parseProductSearch({}), {
      env: { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    })).rejects.toThrow(/configuration/);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive internal error', { status: 500 }));
    await expect(searchProducts(parseProductSearch({}), {
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'key' }, fetcher,
    })).rejects.toThrow('status 500');
  });
});
