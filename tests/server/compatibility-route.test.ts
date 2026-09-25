import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompatibilityProduct } from '../../src/server/catalog/compatibility';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../src/server/catalog/compatibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/catalog/compatibility')>();
  return { ...actual, loadCompatibilityProducts: load };
});
import { POST } from '../../src/app/api/compatibility/route';

const cpu = { id: '00000000-0000-4000-8000-000000000001', category: 'cpu', specs: { socket_code: 'AM5' } } as CompatibilityProduct;
const mb = { id: '00000000-0000-4000-8000-000000000002', category: 'motherboard', specs: { socket_code: 'AM5', ddr_generation: 'DDR5', form_factor: 'ATX' } } as CompatibilityProduct;

describe('POST /api/compatibility', () => {
  beforeEach(() => load.mockReset());

  it('returns five findings for published selections', async () => {
    load.mockResolvedValue([cpu, mb]);
    const response = await POST(new Request('http://local/api/compatibility', { method: 'POST', body: JSON.stringify({ products: [
      { category: 'cpu', productId: cpu.id }, { category: 'motherboard', productId: mb.id },
    ] }) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(5);
    expect(body.data[0]).toMatchObject({ status: 'compatible', comparedValues: { cpuSocketCode: 'AM5', motherboardSocketCode: 'AM5' } });
  });

  it('rejects malformed input and absent/unpublished IDs', async () => {
    const bad = await POST(new Request('http://local/api/compatibility', { method: 'POST', body: '{bad' }));
    expect(bad.status).toBe(400);
    load.mockResolvedValue([]);
    const missing = await POST(new Request('http://local/api/compatibility', { method: 'POST', body: JSON.stringify({ products: [{ category: 'cpu', productId: cpu.id }] }) }));
    expect(missing.status).toBe(404);
  });

  it('rejects a product whose category does not match the submitted category', async () => {
    load.mockResolvedValue([cpu]);
    const response = await POST(new Request('http://local/api/compatibility', { method: 'POST', body: JSON.stringify({ products: [{ category: 'gpu', productId: cpu.id }] }) }));
    expect(response.status).toBe(404);
  });
});
