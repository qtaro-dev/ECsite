import { describe, expect, it } from 'vitest';
import { AdminPrebuiltPcCreateSchema, PrebuiltPcComponentsSchema } from '@/lib/admin-prebuilt-pc-schemas';

const components = {
  cpu: { label: 'CPU name', details: '8 cores' },
  gpu: { label: 'GPU name', details: '12 GB' },
  memory: { label: 'Memory name', details: '32 GB' },
  ssd: { label: 'SSD name', details: '1 TB' },
};
const complete = {
  slug: 't58-prebuilt-pc', sku: 'T58-PC-01', name: 'Prebuilt PC', brand: 'Demo',
  description: 'Description', beginnerNote: 'Note', priceTaxIncludedYen: 100_000, status: 'published',
  weightG: 15_000, packLengthMm: 600, packWidthMm: 250, packHeightMm: 550, useCases: ['gaming'], components,
};

describe('T58 prebuilt PC admin schemas', () => {
  it('accepts the component JSON contract with optional parts', () => {
    expect(PrebuiltPcComponentsSchema.safeParse({ ...components, powerSupply: { label: 'PSU', details: '750 W' } }).success).toBe(true);
  });

  it('rejects unknown nested keys and missing required components', () => {
    expect(PrebuiltPcComponentsSchema.safeParse({ ...components, cpu: { ...components.cpu, sku: 'component-link' } }).success).toBe(false);
    expect(PrebuiltPcComponentsSchema.safeParse({ cpu: components.cpu, gpu: components.gpu, memory: components.memory }).success).toBe(false);
  });

  it('accepts an empty-configuration draft but rejects incomplete publication', () => {
    expect(AdminPrebuiltPcCreateSchema.safeParse({ slug: 'draft-pc', sku: 'DRAFT-PC' }).success).toBe(true);
    const result = AdminPrebuiltPcCreateSchema.safeParse({ ...complete, components: null, status: 'published' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(({ message }) => message.includes('グラフィックボード'))).toBe(true);
  });

  it('requires a use case and enforces Yamato limits for publication', () => {
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, useCases: [] }).success).toBe(false);
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, weightG: 30_001 }).success).toBe(false);
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, packLengthMm: 1_701 }).success).toBe(false);
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, packLengthMm: 1_000, packWidthMm: 700, packHeightMm: 500 }).success).toBe(false);
  });

  it('rejects duplicate use cases and unknown fields', () => {
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, useCases: ['gaming', 'gaming'] }).success).toBe(false);
    expect(AdminPrebuiltPcCreateSchema.safeParse({ ...complete, componentSku: 'SKU-1' }).success).toBe(false);
  });
});
