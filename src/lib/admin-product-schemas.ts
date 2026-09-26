import { z } from 'zod';

const optionalText = (max: number) => z.string().max(max).optional().default('');
const optionalInt = () => z.number().int().positive().max(2_147_483_647).nullable().optional();

export const AdminProductCategorySchema = z.enum([
  'cpu', 'gpu', 'motherboard', 'memory', 'ssd', 'power-supply', 'pc-case', 'cpu-cooler',
]);
export const AdminProductStatusSchema = z.enum(['draft', 'published', 'hidden']);
export const AdminProductUseCaseSchema = z.enum(['gaming', 'daily', 'editing']);

const ProductFields = {
  category: AdminProductCategorySchema,
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sku: z.string().trim().min(1).max(80),
  name: optionalText(240),
  brand: optionalText(120),
  description: optionalText(5000),
  beginnerNote: optionalText(2000),
  priceTaxIncludedYen: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
  status: AdminProductStatusSchema.default('draft'),
  weightG: optionalInt(),
  packLengthMm: optionalInt(),
  packWidthMm: optionalInt(),
  packHeightMm: optionalInt(),
  useCases: z.array(AdminProductUseCaseSchema).max(3).default([]),
  specifications: z.record(z.string(), z.union([z.string().max(120), z.number().int().positive(), z.array(z.string().max(32)), z.null()])).default({}),
};

const specFieldsByCategory: Record<z.infer<typeof AdminProductCategorySchema>, Record<string, 'text' | 'positiveInteger' | 'textList'>> = {
  cpu: { socket_code: 'text', core_count: 'positiveInteger', base_clock_mhz: 'positiveInteger', tdp_w: 'positiveInteger' },
  gpu: { chipset: 'text', vram_gb: 'positiveInteger', card_length_mm: 'positiveInteger' },
  motherboard: { socket_code: 'text', ddr_generation: 'text', form_factor: 'text' },
  memory: { ddr_generation: 'text', capacity_gb: 'positiveInteger', module_count: 'positiveInteger', speed_mt_s: 'positiveInteger' },
  ssd: { capacity_gb: 'positiveInteger', interface: 'text', form_factor: 'text' },
  'power-supply': { rated_w: 'positiveInteger', form_factor: 'text', efficiency_grade: 'text' },
  'pc-case': { max_gpu_length_mm: 'positiveInteger', outer_length_mm: 'positiveInteger', outer_width_mm: 'positiveInteger', outer_height_mm: 'positiveInteger', supported_form_factors: 'textList' },
  'cpu-cooler': { supported_socket_codes: 'textList', height_mm: 'positiveInteger', cooling_type: 'text' },
};
const requiredSpecFieldsByCategory: Partial<Record<z.infer<typeof AdminProductCategorySchema>, string[]>> = {
  gpu: ['chipset', 'vram_gb'], ssd: ['capacity_gb', 'interface', 'form_factor'],
  'power-supply': ['rated_w', 'form_factor', 'efficiency_grade'],
  'pc-case': ['outer_length_mm', 'outer_width_mm', 'outer_height_mm'],
  'cpu-cooler': ['height_mm', 'cooling_type'],
};
const nullableSpecFieldsByCategory: Record<z.infer<typeof AdminProductCategorySchema>, Set<string>> = {
  cpu: new Set(['socket_code', 'core_count', 'base_clock_mhz', 'tdp_w']),
  gpu: new Set(['card_length_mm']),
  motherboard: new Set(['socket_code', 'ddr_generation', 'form_factor']),
  memory: new Set(['ddr_generation', 'capacity_gb', 'module_count', 'speed_mt_s']),
  ssd: new Set(),
  'power-supply': new Set(),
  'pc-case': new Set(['max_gpu_length_mm', 'supported_form_factors']),
  'cpu-cooler': new Set(['supported_socket_codes']),
};

function validateSpecifications(value: z.infer<z.ZodObject<typeof ProductFields>>, context: z.RefinementCtx) {
  const allowed = specFieldsByCategory[value.category];
  for (const [field, fieldValue] of Object.entries(value.specifications)) {
    const type = allowed[field];
    const valid = (fieldValue === null && nullableSpecFieldsByCategory[value.category].has(field))
      || (type === 'text' ? typeof fieldValue === 'string'
        : type === 'positiveInteger' ? typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue) && fieldValue > 0
          : type === 'textList' ? Array.isArray(fieldValue) && fieldValue.length <= 5 && fieldValue.every((item) => typeof item === 'string')
            : false);
    if (!valid) context.addIssue({ code: 'custom', path: ['specifications', field], message: 'カテゴリの仕様項目と値を確認してください。' });
    if ((field === 'ddr_generation' && fieldValue !== null && fieldValue !== 'DDR4' && fieldValue !== 'DDR5')
      || ((field === 'form_factor' || field === 'supported_form_factors') && fieldValue !== null
        && !(Array.isArray(fieldValue) ? fieldValue.every((item) => ['ATX', 'mATX', 'ITX'].includes(item)) : ['ATX', 'mATX', 'ITX'].includes(String(fieldValue))))) {
      context.addIssue({ code: 'custom', path: ['specifications', field], message: '選択可能な規格を指定してください。' });
    }
    if ((field === 'supported_form_factors' || field === 'supported_socket_codes') && Array.isArray(fieldValue)
      && new Set(fieldValue).size !== fieldValue.length) {
      context.addIssue({ code: 'custom', path: ['specifications', field], message: '重複する値は登録できません。' });
    }
  }
  if (value.status === 'published') {
    for (const field of requiredSpecFieldsByCategory[value.category] ?? []) {
      const fieldValue = value.specifications[field];
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        context.addIssue({ code: 'custom', path: ['specifications', field], message: '公開にはこの仕様が必要です。' });
      }
    }
    for (const field of ['name', 'brand', 'description', 'beginnerNote'] as const) {
      if (!value[field].trim()) context.addIssue({ code: 'custom', path: [field], message: '公開には入力が必要です。' });
    }
    if (value.priceTaxIncludedYen === undefined || value.priceTaxIncludedYen === null) {
      context.addIssue({ code: 'custom', path: ['priceTaxIncludedYen'], message: '公開には税込価格が必要です。' });
    }
    for (const field of ['weightG', 'packLengthMm', 'packWidthMm', 'packHeightMm'] as const) {
      if (value[field] === undefined || value[field] === null) context.addIssue({ code: 'custom', path: [field], message: '公開には梱包情報が必要です。' });
    }
  }
}

export const AdminProductCreateSchema = z.object(ProductFields).strict().superRefine((value, context) => {
  validateShippingLimits(value, context);
  validateSpecifications(value, context);
});
export const AdminProductUpdateSchema = z.object({ ...ProductFields, expectedVersion: z.number().int().nonnegative() })
  .strict().superRefine((value, context) => {
    validateShippingLimits(value, context);
    validateSpecifications(value, context);
  });

function validateShippingLimits(value: z.infer<z.ZodObject<typeof ProductFields>>, context: z.RefinementCtx) {
  if (value.status !== 'published') return;
  if (value.status === 'published' && value.weightG && value.weightG > 30_000) context.addIssue({ code: 'custom', path: ['weightG'], message: 'ヤマト運輸の重量上限30kgを超えています。' });
  const dims = [value.packLengthMm, value.packWidthMm, value.packHeightMm];
  if (value.status === 'published' && dims.every((dimension) => dimension !== null && dimension !== undefined)
    && dims.reduce((sum, dimension) => sum + (dimension ?? 0), 0) > 2_000) {
    context.addIssue({ code: 'custom', path: ['packLengthMm'], message: '梱包サイズ3辺の合計が200cmを超えています。' });
  }
  if (value.status === 'published' && dims.some((dimension) => dimension !== null && dimension !== undefined && dimension > 1_700)) {
    context.addIssue({ code: 'custom', path: ['packLengthMm'], message: '梱包の1辺が170cmを超えています。' });
  }
}

export const AdminProductImageSchema = z.object({
  id: z.uuid(), storagePath: z.string().min(1).max(512), altText: z.string().min(1).max(240), sortOrder: z.number().int().min(0),
}).strict();
export const AdminProductImageInputSchema = AdminProductImageSchema.omit({ id: true });
export const AdminProductSaveFormSchema = z.object({
  productId: z.uuid().optional(),
  fields: z.unknown(),
  images: z.array(AdminProductImageInputSchema),
  imageAltText: z.string().trim().min(1).max(240),
}).strict().superRefine((value, context) => {
  const paths = value.images.map((image) => image.storagePath);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: 'custom', path: ['images'], message: '同じ画像を重複して指定できません。' });
  }
});

export const AdminProductListItemSchema = z.object({
  id: z.uuid(), category: AdminProductCategorySchema, slug: z.string(), sku: z.string(),
  name: z.string(), brand: z.string(), status: AdminProductStatusSchema,
  priceTaxIncludedYen: z.number().int().nonnegative().nullable(), version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export const AdminProductListSchema = z.array(AdminProductListItemSchema).max(100);
export const AdminProductDetailSchema = AdminProductListItemSchema.extend({
  description: z.string(), beginnerNote: z.string(), weightG: z.number().int().positive().nullable(),
  packLengthMm: z.number().int().positive().nullable(), packWidthMm: z.number().int().positive().nullable(),
  packHeightMm: z.number().int().positive().nullable(), useCases: z.array(AdminProductUseCaseSchema),
  specifications: z.record(z.string(), z.unknown()),
  images: z.array(z.object({ storagePath: z.string().min(1), altText: z.string() }).strict()),
}).strict();

export type AdminProductCreate = z.infer<typeof AdminProductCreateSchema>;
export type AdminProductUpdate = z.infer<typeof AdminProductUpdateSchema>;
export type AdminProductDetail = z.infer<typeof AdminProductDetailSchema>;
export type AdminProductCategory = z.infer<typeof AdminProductCategorySchema>;
