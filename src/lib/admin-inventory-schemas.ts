import { z } from 'zod';

export const AdminInventoryAdjustmentInputSchema = z.object({
  productId: z.uuid(),
  delta: z.number().int().safe().min(-2_147_483_647).max(2_147_483_647).refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().safe().nonnegative(),
}).strict();

export const AdminInventoryItemSchema = z.object({
  productId: z.uuid(), category: z.string(), sku: z.string(), name: z.string(), status: z.enum(['draft', 'published', 'hidden']),
  onHand: z.number().int().nonnegative(), allocated: z.number().int().nonnegative(), available: z.number().int().nonnegative(),
  version: z.number().int().safe().nonnegative(),
}).strict();

export const AdminInventoryAdjustmentLogSchema = z.object({
  id: z.uuid(), productId: z.uuid(), productName: z.string(), delta: z.number().int(), reason: z.string(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const AdminInventoryResponseSchema = z.object({
  items: z.array(AdminInventoryItemSchema).max(50), adjustments: z.array(AdminInventoryAdjustmentLogSchema).max(50),
  page: z.number().int().positive(), pageSize: z.literal(50), total: z.number().int().nonnegative(), totalPages: z.number().int().positive(),
}).strict();

export const AdminInventoryStateSchema = AdminInventoryItemSchema.pick({ productId: true, onHand: true, allocated: true, available: true, version: true }).strict();
