import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { AdminOverviewSchema } from '../../src/lib/admin-schemas';
import { getAdminOverview } from '../../src/server/admin/overview';

describe('admin dashboard projection', () => {
  it('returns operational counts only and counts allocated stock as unavailable', async () => {
    const values: Record<string, unknown> = {
      products: { count: 2, error: null },
      orders: { count: 7, error: null },
      notification_jobs: { count: 1, error: null },
      inventory: { data: [{ on_hand: 5, allocated: 2 }, { on_hand: 3, allocated: 3 }], error: null },
    };
    const query = (value: unknown) => {
      const pending = Promise.resolve(value) as Promise<unknown> & { is?: (column: string, filter: null) => Promise<unknown> };
      pending.is = () => Promise.resolve(value);
      return pending;
    };
    const client = { from(table: string) { return { select() { return {
      eq() { return query(values[table]); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(values[table]).then(resolve); },
    }; } }; } };
    const counts = await getAdminOverview(client as never);
    expect(counts).toEqual({ publishedProducts: 2, outOfStockProducts: 1, orders: 7, notificationFailures: 1 });
    expect(AdminOverviewSchema.parse({ ...counts, auditId: '9ab65412-8e9a-4d26-a44d-0b5f59cebf2f' })).toEqual({
      ...counts, auditId: '9ab65412-8e9a-4d26-a44d-0b5f59cebf2f',
    });
  });

  it('fails closed when any operational count query fails', async () => {
    const failedCount = () => {
      const promise = Promise.resolve({ count: null, error: new Error('private detail') }) as Promise<unknown> & { is?: () => Promise<unknown> };
      promise.is = () => Promise.resolve({ count: null, error: new Error('private detail') });
      return promise;
    };
    const client = { from() { return { select() { return {
      eq() { return failedCount(); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    }; } }; } };
    await expect(getAdminOverview(client as never)).rejects.toThrow('Dashboard data unavailable');
  });
});
