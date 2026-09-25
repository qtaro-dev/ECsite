import { z } from 'zod';
import { YAMATO_SOURCE_URL, type YamatoSizeCode } from '@/server/shipping/calculator';

export const ShippingPrefectureCodeSchema = z.number().int().min(1).max(47);
export const ShippingSizeCodeSchema = z.union([
  z.literal(60), z.literal(80), z.literal(100), z.literal(120),
  z.literal(140), z.literal(160), z.literal(180), z.literal(200),
]);

export const ShippingRateSchema = z.object({
  originPrefectureCode: ShippingPrefectureCodeSchema,
  destinationPrefectureCode: ShippingPrefectureCodeSchema,
  sizeCode: ShippingSizeCodeSchema,
  feeYen: z.number().int().nonnegative().max(2147483647),
}).strict();

export const ShippingRateTableSchema = z.object({
  rates: z.array(ShippingRateSchema).max(47 * 47 * 8),
}).strict().superRefine(({ rates }, context) => {
  const keys = new Set<string>();
  rates.forEach((rate, index) => {
    const key = `${rate.originPrefectureCode}:${rate.destinationPrefectureCode}:${rate.sizeCode}`;
    if (keys.has(key)) context.addIssue({ code: 'custom', path: ['rates', index], message: 'Duplicate shipping rate key' });
    keys.add(key);
  });
});

const OfficialSourceUrlSchema = z.url().refine((value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'kuronekoyamato.co.jp' || host.endsWith('.kuronekoyamato.co.jp');
  } catch { return false; }
}, 'Official Yamato URL is required');

export const ShippingSettingsFieldsSchema = z.object({
  originPrefectureCode: ShippingPrefectureCodeSchema,
  baseFeeYen: z.number().int().nonnegative().max(2147483647),
  freeThresholdYen: z.number().int().nonnegative().max(2147483647),
  heavyThresholdG: z.literal(20000),
  heavyRuleJson: ShippingRateTableSchema,
  yamatoSourceUrl: OfficialSourceUrlSchema,
  sourceCheckedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((settings, context) => {
  if (settings.heavyRuleJson.rates.length > 0 && !settings.sourceCheckedAt) {
    context.addIssue({ code: 'custom', path: ['sourceCheckedAt'], message: 'A review date is required when rates are present' });
  }
});

export const AdminShippingSettingsSchema = z.object({
  id: z.uuid(),
  version: z.string().min(1).max(96),
  ...ShippingSettingsFieldsSchema.shape,
  activeFrom: z.string().datetime({ offset: true }),
  isActive: z.boolean(),
}).strict();

export const AdminShippingSettingsResultSchema = z.object({
  active: AdminShippingSettingsSchema,
  history: z.array(AdminShippingSettingsSchema).max(10),
  auditId: z.uuid(),
}).strict();

export const AdminShippingSettingsUpdateSchema = ShippingSettingsFieldsSchema.extend({
  expectedVersion: z.string().min(1).max(96),
}).strict();

const ShippingPreviewItemSchema = z.object({
  unitPriceYen: z.number().int().safe().nonnegative(),
  quantity: z.number().int().min(1).max(10),
  weightG: z.number().int().positive().max(30000),
  packLengthMm: z.number().int().positive().max(1700).nullable(),
  packWidthMm: z.number().int().positive().max(1700).nullable(),
  packHeightMm: z.number().int().positive().max(1700).nullable(),
}).strict();

export const AdminShippingPreviewRequestSchema = ShippingSettingsFieldsSchema.extend({
  destinationPrefectureCode: ShippingPrefectureCodeSchema,
  items: z.array(ShippingPreviewItemSchema).min(1).max(20),
}).strict();

export const AdminShippingPreviewResultSchema = z.object({
  quote: z.object({
    settingsVersion: z.string().min(1),
    originPrefectureCode: ShippingPrefectureCodeSchema,
    destinationPrefectureCode: ShippingPrefectureCodeSchema,
    goodsTotalYen: z.number().int().nonnegative(),
    shippingBaseYen: z.number().int().nonnegative(),
    shippingHeavyYen: z.number().int().nonnegative(),
    shippingTotalYen: z.number().int().nonnegative(),
    taxTotalYen: z.number().int().nonnegative(),
    grandTotalYen: z.number().int().nonnegative(),
    sourceUrl: OfficialSourceUrlSchema,
    sourceCheckedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
}).strict();

export const AdminShippingPreviewFailureSchema = z.object({
  error: z.object({
    code: z.literal('SHIPPING_UNAVAILABLE'),
    reason: z.enum(['package_unavailable', 'yamato_limit_exceeded', 'rate_table_unavailable', 'rate_unavailable', 'address_required', 'invalid_items', 'invalid_settings', 'inactive_settings']),
    message: z.string(),
    nextAction: z.string(),
  }).strict(),
}).strict();

export type AdminShippingSettings = z.infer<typeof AdminShippingSettingsSchema>;
export type AdminShippingSettingsResult = z.infer<typeof AdminShippingSettingsResultSchema>;
export type AdminShippingSettingsUpdate = z.infer<typeof AdminShippingSettingsUpdateSchema>;
export type AdminShippingPreviewQuote = z.infer<typeof AdminShippingPreviewResultSchema>['quote'];
export type ShippingRate = z.infer<typeof ShippingRateSchema> & { sizeCode: YamatoSizeCode };
export { YAMATO_SOURCE_URL };
