import { expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/admin/overview', () => ({ createAdminDataClient: () => ({ from }) }));

import { getAdminProduct } from '../../src/server/admin/products';

it('returns a validated detail record including the database update timestamp', async () => {
  const productId = '88888888-8888-4888-8888-888888888888';
  const updatedAt = '2026-09-27T01:02:03.000Z';
  from.mockImplementation((table: string) => {
    const result = table === 'products'
      ? { id: productId, slug: 'test-cpu', sku: 'TEST-CPU', name: 'Test CPU', brand: 'Test',
        description: '', beginner_note: '', price_tax_included_yen: 1000, status: 'draft', weight_g: null,
        pack_length_mm: null, pack_width_mm: null, pack_height_mm: null, version: 1, updated_at: updatedAt,
        categories: { slug: 'cpu' } }
      : table === 'cpu_specs' ? { product_id: productId, socket_code: 'AM5' } : null;
    const rows = table === 'product_use_cases' ? [{ use_case: 'gaming' }] : [];
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: result, error: null })),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return query;
  });

  await expect(getAdminProduct(productId)).resolves.toMatchObject({
    id: productId, category: 'cpu', updatedAt, specifications: { socket_code: 'AM5' }, useCases: ['gaming'],
  });
});
