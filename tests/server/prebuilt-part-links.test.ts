import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { getPublishedPrebuiltPartLinks } from '@/server/catalog/prebuilt-part-links';

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  vi.unstubAllGlobals();
});

it('links only parts returned by public product visibility', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-key';
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json([{ slot: 'cpu', part_product_id: 'cpu-id' }, { slot: 'gpu', part_product_id: 'hidden-id' }]))
    .mockResolvedValueOnce(Response.json([{ id: 'cpu-id', slug: 'visible-cpu' }]));
  vi.stubGlobal('fetch', fetcher);
  await expect(getPublishedPrebuiltPartLinks('pc-id')).resolves.toEqual({ cpu: 'visible-cpu' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps the PC detail available when optional reference lookup fails', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-key';
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('transient outage')));
  await expect(getPublishedPrebuiltPartLinks('pc-id')).resolves.toEqual({});
});
