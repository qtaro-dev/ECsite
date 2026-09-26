import { describe, expect, it } from 'vitest';
import { AdminProductCreateSchema, AdminProductSaveFormSchema } from '@/lib/admin-product-schemas';

const draft = {
  category: 'cpu' as const,
  slug: 'test-cpu', sku: 'TEST-CPU', status: 'draft' as const,
  useCases: [], specifications: {},
};

describe('admin product input', () => {
  it('accepts an incomplete specification for a draft', () => {
    expect(AdminProductCreateSchema.safeParse(draft).success).toBe(true);
  });

  it('rejects malformed slugs and unknown input fields', () => {
    expect(AdminProductCreateSchema.safeParse({ ...draft, slug: 'Test CPU' }).success).toBe(false);
    expect(AdminProductCreateSchema.safeParse({ ...draft, admin: true }).success).toBe(false);
  });

  it('rejects published shipment dimensions above the Yamato limits', () => {
    const result = AdminProductCreateSchema.safeParse({
      ...draft, status: 'published', weightG: 30001,
      packLengthMm: 1000, packWidthMm: 700, packHeightMm: 400,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toContain('weightG');
  });

  it('allows nullable compatibility fields on a published product but requires non-null category columns', () => {
    const completeProduct = {
      ...draft, status: 'published' as const, name: 'CPU', brand: 'Maker', description: 'Description', beginnerNote: 'Guide',
      priceTaxIncludedYen: 1000, weightG: 500, packLengthMm: 100, packWidthMm: 100, packHeightMm: 50,
      specifications: { socket_code: null, core_count: null, base_clock_mhz: null, tdp_w: null },
    };
    expect(AdminProductCreateSchema.safeParse(completeProduct).success).toBe(true);
    expect(AdminProductCreateSchema.safeParse({ ...completeProduct, category: 'gpu', specifications: { chipset: 'X', vram_gb: null } }).success).toBe(false);
  });

  it('accepts an incomplete GPU draft without a spec row', () => {
    expect(AdminProductCreateSchema.safeParse({ ...draft, category: 'gpu', specifications: {} }).success).toBe(true);
  });

  it('rejects blank whitespace in required published text specifications', () => {
    const result = AdminProductCreateSchema.safeParse({
      ...draft, category: 'gpu', status: 'published', name: 'GPU', brand: 'Maker', description: 'Description', beginnerNote: 'Guide',
      priceTaxIncludedYen: 1000, weightG: 500, packLengthMm: 100, packWidthMm: 100, packHeightMm: 50,
      specifications: { chipset: '   ', vram_gb: 8 },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('specifications.chipset');
  });

  it('rejects duplicate retained image paths in an admin save request', () => {
    const image = { storagePath: '12345678-1234-4234-8234-123456789012/a.jpg', altText: 'front', sortOrder: 0 };
    const result = AdminProductSaveFormSchema.safeParse({ fields: draft, images: [image, image], imageAltText: 'new image' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['images']);
  });
});
