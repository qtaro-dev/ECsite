import { z } from 'zod';

export const AdminOverviewSchema = z.object({
  publishedProducts: z.number().int().nonnegative(),
  outOfStockProducts: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  notificationFailures: z.number().int().nonnegative(),
  auditId: z.string().uuid(),
}).strict();
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;
