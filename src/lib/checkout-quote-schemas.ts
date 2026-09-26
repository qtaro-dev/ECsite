import { z } from 'zod';
import { AddressSchema, CompatibilityFindingSchema, IdSchema, ProductCategorySchema } from '@/lib/schemas';

export const CheckoutQuoteRequestSchema = z.object({
  addressId: IdSchema,
}).strict();

export const CheckoutQuoteAddressSchema = AddressSchema.extend({ id: IdSchema }).strict();

export const CheckoutQuoteResultSchema = z.object({
  quoteId: IdSchema,
  expiresAt: z.string().datetime({ offset: true }),
  address: CheckoutQuoteAddressSchema,
  items: z.array(z.object({
    productId: IdSchema,
    sku: z.string().min(1),
    name: z.string().min(1),
    brand: z.string().min(1),
    category: ProductCategorySchema,
    quantity: z.number().int().min(1).max(10),
    unitPriceYen: z.number().int().safe().nonnegative(),
    lineTotalYen: z.number().int().safe().nonnegative(),
    availableQuantity: z.number().int().nonnegative(),
    taxRateBasisPoints: z.literal(1000),
    unitPriceAtAddYen: z.number().int().safe().nonnegative().nullable(),
  }).strict()).min(1),
  priceChanges: z.array(z.object({ productId: IdSchema, name: z.string().min(1), unitPriceAtAddYen: z.number().int().safe().nonnegative(), unitPriceYen: z.number().int().safe().nonnegative() }).strict()),
  goodsTotalYen: z.number().int().safe().nonnegative(),
  shipping: z.object({
    baseYen: z.number().int().safe().nonnegative(),
    heavyYen: z.number().int().safe().nonnegative(),
    totalYen: z.number().int().safe().nonnegative(),
  }).strict(),
  taxTotalYen: z.number().int().safe().nonnegative(),
  grandTotalYen: z.number().int().safe().nonnegative(),
  shippingSettingsVersion: z.string().min(1),
  shippingSourceUrl: z.url(),
  shippingSourceCheckedAt: z.string().datetime({ offset: true }).nullable(),
  compatibility: z.array(CompatibilityFindingSchema).length(5),
}).strict().refine((quote) => quote.items.reduce((sum, item) => sum + item.lineTotalYen, 0) === quote.goodsTotalYen
  && quote.shipping.baseYen + quote.shipping.heavyYen === quote.shipping.totalYen
  && quote.goodsTotalYen + quote.shipping.totalYen === quote.grandTotalYen
  && Math.floor(quote.grandTotalYen / 11) === quote.taxTotalYen);

export const CheckoutQuoteApiResponseSchema = z.object({
  data: CheckoutQuoteResultSchema,
  requestId: z.string().min(1),
}).strict();

export type CheckoutQuoteResult = z.infer<typeof CheckoutQuoteResultSchema>;
