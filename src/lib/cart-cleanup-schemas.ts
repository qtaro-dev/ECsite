import { z } from 'zod';
import { IdSchema } from './schemas';

export const PaidCartCleanupRequestSchema = z.object({ orderId: IdSchema }).strict();
export const PaidCartCleanupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['cleared', 'unchanged']), clearedLines: z.number().int().nonnegative().optional() }).strict(),
  z.object({ status: z.enum(['later_order', 'not_found']) }).strict(),
]);
