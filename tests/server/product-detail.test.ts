import { describe, expect, it, vi } from 'vitest';
import { getPublishedProductDetail, productImageUrl } from '../../src/server/catalog/product-detail';
import { GET as getProductImage } from '../../src/app/api/product-images/[...path]/route';

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co/', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const product = { id: 'id', slug: 'cpu-one', sku: 'SKU', name: 'CPU', brand: 'Maker', category: 'cpu', description: '', beginnerNote: '', priceYen: 1000, images: [], useCases: [], specifications: { socket_code: 'AM5' }, availableQuantity: 2 };

describe('published product detail service', () => {
  it('calls the publish-only detail RPC with the slug and returns the detail projection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(product)));
    await expect(getPublishedProductDetail('cpu-one', { env, fetcher })).resolves.toEqual(product);
    expect(fetcher.mock.calls[0][0]).toBe('https://example.supabase.co/rest/v1/rpc/get_published_product_detail');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ product_slug: 'cpu-one' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('publishable');
  });

  it('returns null for unpublished slugs and fails closed on RPC errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('null'));
    await expect(getPublishedProductDetail('draft', { env, fetcher })).resolves.toBeNull();
    fetcher.mockResolvedValue(new Response('internal detail', { status: 500 }));
    await expect(getPublishedProductDetail('cpu-one', { env, fetcher })).rejects.toThrow('status 500');
  });

  it('does not cache detail reads across a price change or publication change', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...product, priceYen: 9999 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...product, priceYen: 12999 })))
      .mockResolvedValueOnce(new Response('null'));

    await expect(getPublishedProductDetail('cpu-one', { env, fetcher })).resolves.toMatchObject({ priceYen: 9999 });
    await expect(getPublishedProductDetail('cpu-one', { env, fetcher })).resolves.toMatchObject({ priceYen: 12999 });
    await expect(getPublishedProductDetail('cpu-one', { env, fetcher })).resolves.toBeNull();
    expect(fetcher.mock.calls.map(([, init]) => init?.cache)).toEqual(['no-store', 'no-store', 'no-store']);
  });

  it('builds the private authenticated Storage delivery URL and safely encodes path segments', () => {
    expect(productImageUrl('folder/a b#.webp')).toBe('/api/product-images/folder/a%20b%23.webp');
  });

  it('proxies private images with only the publishable key and rejects unsafe paths', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const response = await getProductImage(new Request('http://localhost/api/product-images/catalog/cpu.png'), {
      params: Promise.resolve({ path: ['catalog', 'cpu.png'] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher.mock.calls[0][0]).toBe('https://example.supabase.co/storage/v1/object/authenticated/product-images/catalog/cpu.png');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('publishable');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
    const unsafe = await getProductImage(new Request('http://localhost/api/product-images/../private.png'), {
      params: Promise.resolve({ path: ['..', 'private.png'] }),
    });
    expect(unsafe.status).toBe(404);
  });
});
