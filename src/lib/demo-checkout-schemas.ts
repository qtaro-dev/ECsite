import { z } from 'zod';
import { CheckoutOrderSnapshotSchema } from './checkout-start-schemas';
import { IdSchema } from './schemas';

export const DemoCheckoutRequestSchema = z.object({
  quoteId: IdSchema,
  userConfirmed: z.literal(true),
}).strict();

export const DemoCheckoutRpcResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['completed', 'already_completed']) }).strict(),
  z.object({ status: z.enum(['not_found', 'quote_expired', 'checkout_started', 'deletion_pending', 'cart_changed',
    'address_unavailable', 'address_changed', 'product_unavailable', 'shipping_unavailable',
    'quote_changed']) }).strict(),
  z.object({ status: z.literal('stock_unavailable'), productId: IdSchema, availableQuantity: z.number().int().nonnegative() }).strict(),
]);

export { CheckoutOrderSnapshotSchema };
