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
export const SearchQuerySchema = z.object({
  q: z.string().max(100).optional(),
  category: z.string().optional(),
  usage: z.string().optional(),
  manufacturer: z.string().optional(),
  minPrice: SearchIntegerSchema.optional(),
  maxPrice: SearchIntegerSchema.optional(),
  sort: ProductSortSchema.optional(),
  page: z.preprocess((value) => {
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(1)).optional(),
}).strict().refine(
  ({ minPrice, maxPrice }) => minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice,
  { path: ['maxPrice'], message: 'maxPrice must be greater than or equal to minPrice' },
);

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

export type Id = z.infer<typeof IdSchema>;
export type Yen = z.infer<typeof YenSchema>;
export type Quantity = z.infer<typeof QuantitySchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type Address = z.infer<typeof AddressSchema>;
export type AddressPatch = z.infer<typeof AddressPatchSchema>;
export type CartItemInput = z.infer<typeof CartItemInputSchema>;
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type CompatibilityStatus = z.infer<typeof CompatibilityStatusSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Converts validation failures to the public error envelope without echoing submitted values. */
export function validationErrorResponse(error: z.ZodError, requestId: string): ApiError {
  const fieldErrors = error.issues.reduce<Record<string, string[]>>((result, issue) => {
    const field = issue.path.map(String).join('.') || '_';
    (result[field] ??= []).push(issue.message);
    return result;
  }, {});

  return {
    error: { code: 'BAD_REQUEST', message: '入力内容を確認してください。', fieldErrors },
    requestId,
  };
}

/** Replaces internal failures with a generic public error; callers supply only a safe code/message. */
export function apiErrorResponse(
  code: string,
  message: string,
  requestId: string,
): ApiError {
  return { error: { code, message }, requestId };
}
