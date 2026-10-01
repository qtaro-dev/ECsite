import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authorizeAdminApi, getPrebuiltPartCandidates } = vi.hoisted(() => ({
  authorizeAdminApi: vi.fn(), getPrebuiltPartCandidates: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/admin/http', () => ({
  authorizeAdminApi,
  adminError: (status: number) => Response.json({ error: { code: 'UNAVAILABLE' } }, { status }),
  adminSuccess: (data: unknown) => Response.json({ data }),
}));
vi.mock('@/server/admin/prebuilt-part-candidates', () => ({
  PART_CATEGORIES: { cpu: 'cpu', gpu: 'gpu', memory: 'memory', ssd: 'ssd', motherboard: 'motherboard',
    powerSupply: 'power-supply', pcCase: 'pc-case', cpuCooler: 'cpu-cooler' },
  getPrebuiltPartCandidates,
}));
import { GET } from '@/app/api/admin/prebuilt-parts/route';

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdminApi.mockResolvedValue({ access: { userId: 'admin' }, requestId: 'request-test' });
  getPrebuiltPartCandidates.mockResolvedValue({ items: [], page: 0, hasMore: false });
});

it('requires administrator access before searching', async () => {
  authorizeAdminApi.mockResolvedValueOnce({ response: Response.json({}, { status: 403 }) });
  const response = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-parts?slot=cpu'));
  if (!response) throw new Error('No response');
  expect(response.status).toBe(403);
  expect(getPrebuiltPartCandidates).not.toHaveBeenCalled();
});

it('validates slot and bounded pagination', async () => {
  const invalid = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-parts?slot=prebuilt-pc'));
  if (!invalid) throw new Error('No response');
  expect(invalid.status).toBe(400);
  const invalidPage = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-parts?slot=cpu&page=1000'));
  if (!invalidPage) throw new Error('No response');
  expect(invalidPage.status).toBe(400);
  const valid = await GET(new NextRequest('https://shop.example/api/admin/prebuilt-parts?slot=gpu&q=Radeon&page=2'));
  if (!valid) throw new Error('No response');
  expect(valid.status).toBe(200);
  expect(getPrebuiltPartCandidates).toHaveBeenCalledWith('gpu', 'Radeon', 2);
});
