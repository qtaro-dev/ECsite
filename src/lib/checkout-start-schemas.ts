import { z } from 'zod';
import { AddressSchema, CompatibilityFindingSchema, IdSchema, ProductCategorySchema, YenSchema } from './schemas';

export const CheckoutStartRequestSchema = z.object({
  quoteId: IdSchema,
  userConfirmed: z.literal(true),
}).strict();

/** A server read-set used only as an optimistic concurrency token for the DB RPC. */
export const CheckoutOrderSnapshotSchema = z.object({
  address: AddressSchema.extend({ id: IdSchema }).strict(),
  items: z.array(z.object({
    productId: IdSchema,
    sku: z.string().min(1),
    name: z.string().min(1),
    brand: z.string().min(1),
    category: ProductCategorySchema,
    quantity: z.number().int().min(1).max(10),
    unitPriceYen: YenSchema,
    lineTotalYen: YenSchema,
    weightG: z.number().int().positive(),
    packLengthMm: z.number().int().positive().nullable(),
    packWidthMm: z.number().int().positive().nullable(),
    packHeightMm: z.number().int().positive().nullable(),
    specs: z.record(z.string(), z.unknown()),
  }).strict()).min(1),
  goodsTotalYen: YenSchema,
  shipping: z.object({ baseYen: YenSchema, heavyYen: YenSchema, totalYen: YenSchema }).strict(),
  taxTotalYen: YenSchema,
  grandTotalYen: YenSchema,
  shippingSettingsVersion: z.string().min(1),
  compatibility: z.array(CompatibilityFindingSchema).length(5),
}).strict().refine((snapshot) => snapshot.items.reduce((total, item) => total + item.lineTotalYen, 0) === snapshot.goodsTotalYen
  && snapshot.shipping.baseYen + snapshot.shipping.heavyYen === snapshot.shipping.totalYen
  && snapshot.goodsTotalYen + snapshot.shipping.totalYen === snapshot.grandTotalYen
  && Math.floor(snapshot.grandTotalYen / 11) === snapshot.taxTotalYen);

export const CheckoutDifferenceSchema = z.object({
  field: z.enum(['price', 'quantity', 'product_added', 'product_removed', 'product_changed', 'goods_total',
    'shipping_base', 'shipping_heavy', 'shipping_rule', 'tax', 'total', 'stock', 'availability']),
  productId: IdSchema.optional(),
  name: z.string().min(1).optional(),
  quotedYen: YenSchema.optional(),
  currentYen: YenSchema.optional(),
  quotedValue: z.string().optional(),
  currentValue: z.string().optional(),
  quotedQuantity: z.number().int().nonnegative().optional(),
  currentQuantity: z.number().int().nonnegative().optional(),
  requestedQuantity: z.number().int().positive().optional(),
  availableQuantity: z.number().int().nonnegative().optional(),
}).strict();

export const CheckoutAllocationRpcResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['created', 'already_created']), orderId: IdSchema, attemptId: IdSchema.nullable(), amountYen: YenSchema, expiresAt: z.string().datetime({ offset: true }), checkoutKey: IdSchema }).strict(),
  z.object({ status: z.enum(['not_found', 'quote_expired', 'cart_changed', 'address_unavailable', 'address_changed', 'product_unavailable', 'shipping_unavailable', 'key_conflict']), nextAction: z.string().optional(), productId: IdSchema.optional() }).strict(),
  z.object({ status: z.literal('stock_unavailable'), items: z.array(z.object({ productId: IdSchema, name: z.string().optional(), requestedQuantity: z.number().int().positive(), availableQuantity: z.number().int().nonnegative() }).strict()), nextAction: z.string() }).strict(),
  z.object({ status: z.literal('snapshot_stale'), differences: z.array(CheckoutDifferenceSchema), nextAction: z.string() }).strict(),
  z.object({ status: z.literal('quote_changed'), changedFields: z.array(z.string()), differences: z.array(CheckoutDifferenceSchema), quotedTotals: z.record(z.string(), YenSchema), currentTotals: z.record(z.string(), YenSchema), nextAction: z.string() }).strict(),
]);

export type CheckoutStartRequest = z.infer<typeof CheckoutStartRequestSchema>;
export type CheckoutOrderSnapshot = z.infer<typeof CheckoutOrderSnapshotSchema>;
export type CheckoutDifference = z.infer<typeof CheckoutDifferenceSchema>;
export type CheckoutAllocationRpcResult = z.infer<typeof CheckoutAllocationRpcResultSchema>;
