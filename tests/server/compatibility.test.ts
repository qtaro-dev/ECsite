import { describe, expect, it, vi } from 'vitest';
import { evaluateCompatibility, loadCompatibilityProducts, parseCompatibilityRequest } from '../../src/server/catalog/compatibility';
import type { CompatibilityProduct } from '../../src/server/catalog/compatibility';

const fixture = (): CompatibilityProduct[] => [
  { id: 'cpu', category: 'cpu', specs: { socket_code: 'AM5' } },
  { id: 'motherboard', category: 'motherboard', specs: { socket_code: 'AM5', ddr_generation: 'DDR5', form_factor: 'ATX' } },
  { id: 'memory', category: 'memory', specs: { ddr_generation: 'DDR5' } },
  { id: 'gpu', category: 'gpu', specs: { card_length_mm: 300 } },
  { id: 'pc-case', category: 'pc-case', specs: { max_gpu_length_mm: 310, supported_form_factors: ['ATX', 'mATX'] } },
  { id: 'cpu-cooler', category: 'cpu-cooler', specs: { supported_socket_codes: ['AM5'] } },
];

describe('compatibility engine', () => {
  it('returns five findings in the specified rule order with matching links', () => {
    const findings = evaluateCompatibility(fixture());
    expect(findings.map(({ rule, status }) => [rule, status])).toEqual([
      ['cpu_motherboard_socket', 'compatible'], ['motherboard_memory_ddr', 'compatible'],
      ['motherboard_case_form_factor', 'compatible'], ['gpu_case_length', 'compatible'], ['cpu_cooler_socket', 'compatible'],
    ]);
    expect(findings.every(({ matchingUrl }) => matchingUrl === null)).toBe(true);
  });

  it('detects all five incompatibilities without blocking purchase', () => {
    const products = fixture();
    products[0].specs.socket_code = 'AM4';
    products[1].specs.ddr_generation = 'DDR4';
    products[1].specs.form_factor = 'ATX';
    products[4].specs.supported_form_factors = ['ITX'];
    products[3].specs.card_length_mm = 320;
    products[4].specs.max_gpu_length_mm = 310;
    products[5].specs.supported_socket_codes = ['LGA1700'];
    const findings = evaluateCompatibility(products);
    expect(findings.map(({ status }) => status)).toEqual(['incompatible', 'incompatible', 'incompatible', 'incompatible', 'incompatible']);
    expect(findings.every(({ reason, matchingUrl }) => reason.length > 0 && matchingUrl?.startsWith('/search?'))).toBe(true);
    expect(findings[0].matchingUrl).toContain('category=motherboard');
    expect(findings[2].matchingUrl).toContain('supported_form_factors');
    expect(findings[3].matchingUrl).toContain('minGpuClearanceMm=320');
    expect(findings[4].matchingUrl).toContain('supported_socket_codes');
  });

  it('reports unknown for missing specifications and not_applicable for unselected pairs', () => {
    const products = fixture();
    products[0].specs.socket_code = null;
    products[1].specs.ddr_generation = undefined;
    products[1].specs.form_factor = null;
    products[3].specs.card_length_mm = null;
    products[5].specs.supported_socket_codes = null;
    const findings = evaluateCompatibility(products);
    expect(findings.map(({ status }) => status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    expect(evaluateCompatibility([]).map(({ status }) => status)).toEqual(Array(5).fill('not_applicable'));
    expect(evaluateCompatibility([{ ...products[0] }])[0].status).toBe('not_applicable');
  });

  it('validates unique category and product IDs', () => {
    expect(() => parseCompatibilityRequest({ products: [{ category: 'cpu', productId: '00000000-0000-4000-8000-000000000001' }, { category: 'cpu', productId: '00000000-0000-4000-8000-000000000002' }] })).toThrow();
    expect(() => parseCompatibilityRequest({ products: [{ category: 'cpu', productId: '00000000-0000-4000-8000-000000000001' }, { category: 'gpu', productId: '00000000-0000-4000-8000-000000000001' }] })).toThrow();
  });

  it('loads product specs through public PostgREST and handles unavailable responses safely', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: '00000000-0000-4000-8000-000000000001', category: { slug: 'cpu' }, cpu_specs: { socket_code: 'AM5' } },
    ])));
    const request = parseCompatibilityRequest({ products: [{ category: 'cpu', productId: '00000000-0000-4000-8000-000000000001' }] });
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key' };
    await expect(loadCompatibilityProducts(request, { env, fetcher })).resolves.toEqual([
      { id: request.products[0].productId, category: 'cpu', specs: { socket_code: 'AM5' } },
    ]);
    expect(String(fetcher.mock.calls[0][0])).toContain('in.%28');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
    await expect(loadCompatibilityProducts(request, { env: { ...env, NEXT_PUBLIC_SUPABASE_URL: undefined } })).rejects.toThrow(/configuration/);
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('private details', { status: 500 }));
    await expect(loadCompatibilityProducts(request, { env, fetcher: failed })).rejects.toThrow('status 500');
  });
});
