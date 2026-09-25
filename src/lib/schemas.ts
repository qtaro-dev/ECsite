import { z } from 'zod';

/** Shared primitive schemas. These validate untrusted input at the server boundary. */
export const IdSchema = z.uuid();
export const YenSchema = z.number().int().safe().nonnegative();
export const QuantitySchema = z.number().int().min(1).max(10);
export const AvailableQuantitySchema = z.number().int().nonnegative();
const SearchIntegerSchema = z.preprocess((value) => {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value);
  return value;
}, z.number().int().nonnegative());

export const ProductSortSchema = z.enum(['price_asc', 'price_desc', 'newest']);
export const ProductUseCaseSchema = z.enum(['gaming', 'daily', 'editing']);
export const ProductCategorySchema = z.enum(['cpu', 'gpu', 'motherboard', 'memory', 'ssd', 'power-supply', 'pc-case', 'cpu-cooler']);
const ProductSpecKeysByCategory: Record<z.infer<typeof ProductCategorySchema>, readonly string[]> = {
  cpu: ['socket_code', 'core_count', 'base_clock_mhz', 'tdp_w'],
  gpu: ['chipset', 'vram_gb', 'card_length_mm'],
  motherboard: ['socket_code', 'ddr_generation', 'form_factor'],
  memory: ['ddr_generation', 'capacity_gb', 'module_count', 'speed_mt_s'],
  ssd: ['capacity_gb', 'interface', 'form_factor'],
  'power-supply': ['rated_w', 'form_factor', 'efficiency_grade'],
  'pc-case': ['max_gpu_length_mm', 'outer_length_mm', 'outer_width_mm', 'outer_height_mm', 'supported_form_factors'],
  'cpu-cooler': ['supported_socket_codes', 'height_mm', 'cooling_type'],
};
const ProductSpecFieldTypes: Record<string, 'text' | 'positiveInteger' | 'textList'> = {
  socket_code: 'text', core_count: 'positiveInteger', base_clock_mhz: 'positiveInteger', tdp_w: 'positiveInteger',
  chipset: 'text', vram_gb: 'positiveInteger', card_length_mm: 'positiveInteger', ddr_generation: 'text',
  form_factor: 'text', capacity_gb: 'positiveInteger', module_count: 'positiveInteger', speed_mt_s: 'positiveInteger',
  interface: 'text', rated_w: 'positiveInteger', efficiency_grade: 'text', max_gpu_length_mm: 'positiveInteger',
  outer_length_mm: 'positiveInteger', outer_width_mm: 'positiveInteger', outer_height_mm: 'positiveInteger',
  supported_form_factors: 'textList', supported_socket_codes: 'textList', height_mm: 'positiveInteger', cooling_type: 'text',
};
export const ProductSpecFilterSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  z.union([z.string().max(100), z.number().int().safe(), z.array(z.string().max(30)).min(1).max(5)]),
).refine((value) => Object.keys(value).length <= 8, 'At most 8 specification filters are supported');
export const SearchQuerySchema = z.object({
  q: z.string().max(100).optional(),
  category: ProductCategorySchema.optional(),
  usage: ProductUseCaseSchema.optional(),
  manufacturer: z.string().max(100).optional(),
  minPrice: SearchIntegerSchema.optional(),
  maxPrice: SearchIntegerSchema.optional(),
  spec: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (value.length > 2048) return value;
    try { return JSON.parse(value); } catch { return value; }
  }, ProductSpecFilterSchema).optional(),
  sort: ProductSortSchema.optional(),
  page: z.preprocess((value) => {
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(1)).optional(),
}).strict().refine(
  ({ minPrice, maxPrice }) => minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice,
  { path: ['maxPrice'], message: 'maxPrice must be greater than or equal to minPrice' },
).refine(({ category, spec }) => !spec || Object.entries(spec).every(([key, value]) => {
  const supported = category
    ? ProductSpecKeysByCategory[category].includes(key)
    : Object.values(ProductSpecKeysByCategory).some((keys) => keys.includes(key));
  const fieldType = ProductSpecFieldTypes[key];
  const valueTypeMatches = fieldType === 'text' ? typeof value === 'string' && value.length > 0
    : fieldType === 'positiveInteger' ? typeof value === 'number' && value > 0
      : fieldType === 'textList' && Array.isArray(value);
  return supported && valueTypeMatches;
}), {
  path: ['spec'], message: 'Specification filters must use fields defined for the selected category',
});

export const AddressSchema = z.object({
  recipientName: z.string().min(1),
  postalCode: z.string().regex(/^[0-9]{7}$/),
  prefectureCode: z.number().int().min(1).max(47),
  city: z.string().min(1),
  street: z.string().min(1),
  building: z.string().nullable().optional(),
  isDefault: z.boolean(),
}).strict();

export const AddressPatchSchema = z.object({
  addressId: IdSchema,
  recipientName: z.string().min(1).optional(),
  postalCode: z.string().regex(/^[0-9]{7}$/).optional(),
  prefectureCode: z.number().int().min(1).max(47).optional(),
  city: z.string().min(1).optional(),
  street: z.string().min(1).optional(),
  building: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length >= 2, {
  message: 'At least one address field must be provided',
});

export const CartItemInputSchema = z.object({ productId: IdSchema, quantity: QuantitySchema }).strict();
export const QuoteRequestSchema = z.object({
  addressId: IdSchema.optional(),
  address: AddressSchema.optional(),
}).strict().refine((value) => Number(value.addressId !== undefined) + Number(value.address !== undefined) === 1, {
  message: 'Exactly one of addressId or address is required',
});

export const CompatibilityStatusSchema = z.enum(['compatible', 'incompatible', 'unknown', 'not_applicable']);
export const OrderStatusSchema = z.enum(['payment_pending', 'paid', 'payment_failed', 'expired', 'review_required']);
export const ProductStatusSchema = z.enum(['draft', 'published', 'hidden']);
export const SmsPurposeSchema = z.enum(['signup', 'password_reset']);
export const SmsFlowSchema = z.enum(['signup', 'password_reset']);

export const ApiSuccessSchema = <T extends z.ZodType>(data: T) => z.object({
  data,
  requestId: z.string().min(1),
}).strict();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
  requestId: z.string().min(1),
});

/** Public error codes are an application-owned subset of the OpenAPI string field. */
export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'UNAVAILABLE',
]);

const PUBLIC_ERROR_MESSAGES: Record<z.infer<typeof ApiErrorCodeSchema>, string> = {
  BAD_REQUEST: '入力内容を確認してください。',
  UNAUTHORIZED: '認証が必要です。',
  FORBIDDEN: 'この操作を実行する権限がありません。',
  NOT_FOUND: '対象の情報が見つかりません。',
  CONFLICT: '状態が更新されています。内容を確認して再度お試しください。',
  RATE_LIMITED: 'しばらく待ってから再度お試しください。',
  UNAVAILABLE: '現在サービスを利用できません。時間をおいて再度お試しください。',
};

const PUBLIC_FIELD_ERROR_MESSAGE = '入力値が正しくありません。';

export type Id = z.infer<typeof IdSchema>;
export type Yen = z.infer<typeof YenSchema>;
export type Quantity = z.infer<typeof QuantitySchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type ProductUseCase = z.infer<typeof ProductUseCaseSchema>;
export type ProductCategory = z.infer<typeof ProductCategorySchema>;
export type ProductSpecFilter = z.infer<typeof ProductSpecFilterSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type AddressPatch = z.infer<typeof AddressPatchSchema>;
export type CartItemInput = z.infer<typeof CartItemInputSchema>;
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type CompatibilityStatus = z.infer<typeof CompatibilityStatusSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Converts validation failures to the public envelope without forwarding Zod messages or values. */
export function validationErrorResponse(error: z.ZodError, requestId: string): ApiError {
  const fieldErrors = error.issues.reduce<Record<string, string[]>>((result, issue) => {
    const field = issue.path.map(String).join('.') || '_';
    (result[field] ??= []).push(PUBLIC_FIELD_ERROR_MESSAGE);
    return result;
  }, {});

  return {
    error: {
      code: 'BAD_REQUEST',
      message: PUBLIC_ERROR_MESSAGES.BAD_REQUEST,
      fieldErrors,
    },
    requestId,
  };
}

/** Builds a public error using only an allowlisted code and fixed message; cause is never serialized. */
export function apiErrorResponse(
  code: z.infer<typeof ApiErrorCodeSchema>,
  requestId: string,
  _cause?: unknown,
): ApiError {
  return { error: { code, message: PUBLIC_ERROR_MESSAGES[code] }, requestId };
}
