import { expect, it, vi } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/server/admin/overview', () => ({ createAdminDataClient: () => ({ from }) }));

import { getAdminPrebuiltPc } from '@/server/admin/prebuilt-pc-read';

const productId = '77777777-7777-4777-8777-777777777777';
const components = {
  cpu: { label: 'CPU', details: '8 cores' }, gpu: { label: 'GPU', details: '12 GB' },
  memory: { label: 'Memory', details: '32 GB' }, ssd: { label: 'SSD', details: '1 TB' },
};

it('reads a legacy prebuilt PC without part references', async () => {
  from.mockImplementation((table: string) => {
    const single = table === 'products'
      ? { id: productId, slug: 'demo-pc', sku: 'DEMO-PC', name: 'Demo PC', brand: 'Demo', description: 'Description', beginner_note: 'Note',
        price_tax_included_yen: 100_000, status: 'draft', weight_g: null, pack_length_mm: null, pack_width_mm: null, pack_height_mm: null,
        version: 2, updated_at: '2026-10-01T00:00:00.000Z', categories: { slug: 'prebuilt-pc' } }
      : table === 'prebuilt_pc_specs' ? { components } : null;
    const rows = table === 'product_use_cases' ? [{ use_case: 'gaming' }] : [];
    const q = {
      select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: single, error: null })),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return q;
  });

  await expect(getAdminPrebuiltPc(productId)).resolves.toMatchObject({
    id: productId, version: 2, useCases: ['gaming'], components, partIds: null, legacyComponents: true, images: [],
  });
});
