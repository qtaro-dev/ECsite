import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ client: { from: vi.fn() }, createSupabaseServerClient: vi.fn() }));
// @ts-expect-error Vitest resolves Next's server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));

import { GET } from '../../src/app/api/catalog/image-categories/route';

const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

describe('cart image category lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and caps IDs before making a public RLS query', async () => {
    const response = await GET(new NextRequest(`http://localhost/api/catalog/image-categories?ids=${id},not-a-uuid`));
    expect(response.status).toBe(400);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('queries only published products through the session client and returns their categories', async () => {
    const query = {
      in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [
        { id, category: { slug: 'cpu' } }, { id: otherId, category: [{ slug: 'prebuilt-pc' }] },
      ], error: null }),
    };
    mocks.client.from.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
    mocks.createSupabaseServerClient.mockResolvedValue(mocks.client);

    const response = await GET(new NextRequest(`http://localhost/api/catalog/image-categories?ids=${id},${otherId}`));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ [id]: 'cpu', [otherId]: 'prebuilt-pc' });
    expect(mocks.client.from).toHaveBeenCalledWith('products');
    expect(query.in).toHaveBeenCalledWith('id', [id, otherId]);
    expect(query.eq).toHaveBeenCalledWith('status', 'published');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
  });
});
