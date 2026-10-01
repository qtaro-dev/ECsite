import { z } from 'zod';
import { AdminProductImageFileSchema, AdminProductImageInputSchema, AdminProductStatusSchema, AdminProductUseCaseSchema } from '@/lib/admin-product-schemas';

const component = z.object({
  label: z.string().trim().min(1).max(120),
  details: z.string().trim().min(1).max(300),
}).strict();

export const PrebuiltPcComponentsSchema = z.object({
  cpu: component,
  gpu: component,
  memory: component,
  ssd: component,
  motherboard: component.optional(),
  powerSupply: component.optional(),
  pcCase: component.optional(),
}).strict();

const PrebuiltPcFields = z.object({
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sku: z.string().trim().min(1).max(80),
  name: z.string().max(240).optional().default(''),
  brand: z.string().max(120).optional().default(''),
  description: z.string().max(5000).optional().default(''),
  beginnerNote: z.string().max(2000).optional().default(''),
  priceTaxIncludedYen: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
  status: AdminProductStatusSchema.default('draft'),
  weightG: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  packLengthMm: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  packWidthMm: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  packHeightMm: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  useCases: z.array(AdminProductUseCaseSchema).max(3).default([]),
  components: PrebuiltPcComponentsSchema.nullable().optional(),
}).strict();

function validatePublishedFields(value: z.infer<typeof PrebuiltPcFields>, context: z.RefinementCtx) {
  if (new Set(value.useCases).size !== value.useCases.length) {
    context.addIssue({ code: 'custom', path: ['useCases'], message: '同じ用途は重複して指定できません。' });
  }
  if (value.status !== 'published') return;
  for (const field of ['name', 'brand', 'description', 'beginnerNote'] as const) {
    if (!value[field].trim()) context.addIssue({ code: 'custom', path: [field], message: '公開には入力が必要です。' });
  }
  if (value.priceTaxIncludedYen == null) context.addIssue({ code: 'custom', path: ['priceTaxIncludedYen'], message: '公開には税込価格が必要です。' });
  if (!value.components) context.addIssue({ code: 'custom', path: ['components'], message: '公開にはCPU・グラフィックボード・メモリ・SSDの構成が必要です。' });
  if (value.useCases.length === 0) context.addIssue({ code: 'custom', path: ['useCases'], message: '公開には用途を1つ以上選択してください。' });
  for (const field of ['weightG', 'packLengthMm', 'packWidthMm', 'packHeightMm'] as const) {
    if (value[field] == null) context.addIssue({ code: 'custom', path: [field], message: '公開には梱包情報が必要です。' });
  }
  if (value.weightG != null && value.weightG > 30_000) context.addIssue({ code: 'custom', path: ['weightG'], message: 'ヤマト運輸の重量上限30kgを超えています。' });
  const dimensions = [value.packLengthMm, value.packWidthMm, value.packHeightMm];
  if (dimensions.every((item) => item != null) && dimensions.reduce<number>((sum, item) => sum + (item ?? 0), 0) > 2_000) {
    context.addIssue({ code: 'custom', path: ['packLengthMm'], message: '梱包サイズ3辺の合計が200cmを超えています。' });
  }
  if (dimensions.some((item) => item != null && item > 1_700)) {
    context.addIssue({ code: 'custom', path: ['packLengthMm'], message: '梱包の1辺が170cmを超えています。' });
  }
}

export const AdminPrebuiltPcCreateSchema = PrebuiltPcFields.superRefine(validatePublishedFields);
export const AdminPrebuiltPcUpdateSchema = PrebuiltPcFields.extend({ expectedVersion: z.number().int().nonnegative() })
  .strict().superRefine(validatePublishedFields);

export const AdminPrebuiltPcImageFileSchema = AdminProductImageFileSchema;
export const AdminPrebuiltPcImageInputSchema = AdminProductImageInputSchema;
export const AdminPrebuiltPcSaveFormSchema = z.object({
  productId: z.uuid().optional(),
  fields: z.unknown(),
  images: z.array(AdminPrebuiltPcImageInputSchema),
  imageAltText: z.string().trim().min(1).max(240),
}).strict().superRefine((value, context) => {
  if (new Set(value.images.map((image) => image.storagePath)).size !== value.images.length) {
    context.addIssue({ code: 'custom', path: ['images'], message: '同じ画像を重複して指定できません。' });
  }
});

const AdminPrebuiltPcBaseSchema = z.object({
  id: z.uuid(), version: z.number().int().nonnegative(), updatedAt: z.string().datetime({ offset: true }),
  slug: z.string(), sku: z.string(), name: z.string(), brand: z.string(), description: z.string(), beginnerNote: z.string(),
  priceTaxIncludedYen: z.number().int().nonnegative().nullable(), status: AdminProductStatusSchema,
  weightG: z.number().int().positive().nullable(), packLengthMm: z.number().int().positive().nullable(),
  packWidthMm: z.number().int().positive().nullable(), packHeightMm: z.number().int().positive().nullable(),
  useCases: z.array(AdminProductUseCaseSchema), components: PrebuiltPcComponentsSchema.nullable(),
  images: z.array(AdminPrebuiltPcImageInputSchema),
}).strict();
export const AdminPrebuiltPcListSchema = z.array(AdminPrebuiltPcBaseSchema.pick({
  id: true, version: true, updatedAt: true, slug: true, sku: true, name: true, brand: true,
  priceTaxIncludedYen: true, status: true,
})).max(100);
export const AdminPrebuiltPcDetailSchema = AdminPrebuiltPcBaseSchema;

export type AdminPrebuiltPcCreate = z.infer<typeof AdminPrebuiltPcCreateSchema>;
export type AdminPrebuiltPcUpdate = z.infer<typeof AdminPrebuiltPcUpdateSchema>;
