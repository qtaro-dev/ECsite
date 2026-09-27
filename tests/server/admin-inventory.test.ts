import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminDataClient } = vi.hoisted(() => ({ createAdminDataClient: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../src/server/admin/overview', () => ({ createAdminDataClient }));
import { adjustAdminInventory, getAdminInventory, InventoryAdjustmentError } from '../../src/server/admin/inventory';

function createPagedClient(total: number) {
  const products = Array.from({ length: total }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    sku: `SKU-${String(index + 1).padStart(3, '0')}`, name: 'Duplicate fixture name', status: 'draft', categories: { slug: 'cpu' },
  })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const ranges: Array<[number, number]> = [];
  const client = {
    from(table: string) {
      if (table === 'products') return {
        select(_columns: string, options?: { head?: boolean }) {
          if (options?.head) return { is: async () => ({ count: total, error: null }) };
          let from = 0;
          let to = 49;
          return {
            is() { return this; },
            order() { return this; },
            range(start: number, end: number) { from = start; to = end; ranges.push([start, end]); return Promise.resolve({ data: products.slice(from, to + 1), error: null }); },
          };
        },
      };
      if (table === 'inventory') return { select() { return { in: async (_column: string, ids: string[]) => ({ data: ids.map((product_id) => ({ product_id, on_hand: 2, allocated: 0, version: 0 })), error: null }) }; } };
      if (table === 'inventory_adjustments') return { select() { return { order() { return { limit: async () => ({ data: [], error: null }) }; } }; } };
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, ranges };
}

describe('admin inventory pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns every product over multiple bounded pages with deterministic name ties', async () => {
    const { client, ranges } = createPagedClient(101);
    createAdminDataClient.mockReturnValue(client);
    const first = await getAdminInventory(1);
    const second = await getAdminInventory(2);
    const last = await getAdminInventory(3);
    expect([first.items.length, second.items.length, last.items.length]).toEqual([50, 50, 1]);
    expect([first.total, second.total, last.total]).toEqual([101, 101, 101]);
    expect([first.totalPages, second.totalPages, last.totalPages]).toEqual([3, 3, 3]);
    expect(new Set([...first.items, ...second.items, ...last.items].map((item) => item.productId)).size).toBe(101);
    expect(ranges).toEqual([[0, 49], [50, 99], [100, 149]]);
  });
});

describe('admin inventory adjustment RPC response mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('picks state fields from the complete successful database response', async () => {
    const createdAt = '2026-09-27T03:04:05.000Z';
    const adjustmentId = '99999999-9999-4999-8999-999999999999';
    const auditId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rpc = vi.fn().mockResolvedValue({ data: {
      status: 'updated', productId: '77777777-7777-4777-8777-777777777777',
      onHand: 4, allocated: 2, available: 2, version: 1, adjustmentId, auditId, createdAt,
    }, error: null });
    createAdminDataClient.mockReturnValue({ rpc });
    const result = await adjustAdminInventory({ productId: '77777777-7777-4777-8777-777777777777', delta: 1, reason: '入庫', expectedVersion: 0 },
      '88888888-8888-4888-8888-888888888888', 't38-request');
    expect(result).toEqual({
      state: { productId: '77777777-7777-4777-8777-777777777777', onHand: 4, allocated: 2, available: 2, version: 1 },
      adjustmentId, auditId, createdAt,
    });
  });

  it('preserves the latest values from a complete conflict response', async () => {
    createAdminDataClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: {
      status: 'conflict', productId: '77777777-7777-4777-8777-777777777777',
      onHand: 8, allocated: 3, available: 5, version: 6,
    }, error: null }) });
    await expect(adjustAdminInventory({ productId: '77777777-7777-4777-8777-777777777777', delta: 1, reason: '入庫', expectedVersion: 2 },
      '88888888-8888-4888-8888-888888888888', 't38-request'))
      .rejects.toMatchObject({ status: 'conflict', latest: { onHand: 8, allocated: 3, available: 5, version: 6 } } satisfies Partial<InventoryAdjustmentError>);
  });
});
