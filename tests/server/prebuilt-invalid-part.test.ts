import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/admin/overview', () => ({ createAdminDataClient: vi.fn() }));
vi.mock('@/server/admin/prebuilt-pc-read', () => ({ getAdminPrebuiltPc: vi.fn() }));
vi.mock('@/server/admin/product-images', () => ({ inspectAndSanitizeProductImage: vi.fn(), ProductImageValidationError: class extends Error {} }));
import { invalidSelectedPart } from '@/server/admin/prebuilt-pcs';
import { createAdminDataClient } from '@/server/admin/overview';

it('identifies the exact selected slot when its catalog product becomes unavailable', async () => {
  const maybeSingle = vi.fn()
    .mockResolvedValueOnce({ data: { id: 'cpu-id', status: 'published', deleted_at: null, categories: { slug: 'cpu' } }, error: null })
    .mockResolvedValueOnce({ data: { id: 'gpu-id', status: 'hidden', deleted_at: null, categories: { slug: 'gpu' } }, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const client = { from: vi.fn().mockReturnValue(query) } as unknown as ReturnType<typeof createAdminDataClient>;
  await expect(invalidSelectedPart(client, { cpu: 'cpu-id', gpu: 'gpu-id' })).resolves.toBe('gpu');
});
