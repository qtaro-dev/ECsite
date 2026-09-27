import { describe, expect, it } from 'vitest';
import { AdminInventoryAdjustmentInputSchema, AdminInventoryResponseSchema } from '../../src/lib/admin-inventory-schemas';

const productId = '77777777-7777-4777-8777-777777777777';

describe('admin inventory schemas', () => {
  it('accepts reasoned signed adjustments with an optimistic version', () => {
    expect(AdminInventoryAdjustmentInputSchema.parse({ productId, delta: -2, reason: '棚卸差異', expectedVersion: 4 })).toEqual({
      productId, delta: -2, reason: '棚卸差異', expectedVersion: 4,
    });
  });

  it('rejects zero, unsafe, blank, and unbounded adjustment inputs', () => {
    for (const delta of [0, 1.2, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      expect(AdminInventoryAdjustmentInputSchema.safeParse({ productId, delta, reason: '棚卸', expectedVersion: 0 }).success).toBe(false);
    }
    expect(AdminInventoryAdjustmentInputSchema.safeParse({ productId, delta: 1, reason: ' ', expectedVersion: 0 }).success).toBe(false);
  });

  it('limits inventory payloads to one page and reports page metadata', () => {
    expect(AdminInventoryResponseSchema.parse({ items: [], adjustments: [], page: 1, pageSize: 50, total: 0, totalPages: 1 })).toMatchObject({ totalPages: 1 });
    expect(AdminInventoryResponseSchema.safeParse({ items: [], adjustments: [], page: 1, pageSize: 100, total: 0, totalPages: 1 }).success).toBe(false);
  });
});
