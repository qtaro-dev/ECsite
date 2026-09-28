import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn() }));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));

import { POST } from '../../src/app/api/checkout/demo-address/route';

const firstId = '00000000-0000-4000-8000-000000000511';
const secondId = '00000000-0000-4000-8000-000000000512';
function request(body: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/checkout/demo-address', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('demo address provisioning', () => {
  let from: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: firstId, is_anonymous: true } }, error: null });
    insert = vi.fn((row) => ({ select: () => ({ single: async () => ({ data: {
      id: row.user_id === firstId ? firstId : secondId, ...row, created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:00:00Z',
    }, error: null }) }) }));
    from = vi.fn(() => {
      const query = { select: () => query, eq: () => query, is: () => query, order: () => query,
        limit: () => query, maybeSingle: async () => ({ data: null, error: null }), insert };
      return query;
    });
    mocks.createCartServiceClient.mockReturnValue({ from });
  });

  it('creates identical fictional fields for separate owner IDs and chosen regions', async () => {
    const first = await POST(request({ prefectureCode: 13 }));
    expect(first.status).toBe(201);
    const firstRow = insert.mock.calls[0][0];
    expect(firstRow).toMatchObject({ user_id: firstId, recipient_name: 'デモ購入者', postal_code: '0000000', prefecture_code: 13, city: '架空市', street: 'デモ専用1番地' });
    mocks.getUser.mockResolvedValue({ data: { user: { id: secondId, is_anonymous: true } }, error: null });
    const second = await POST(request({ prefectureCode: 1 }));
    expect(second.status).toBe(201);
    expect(insert.mock.calls[1][0]).toMatchObject({ user_id: secondId, prefecture_code: 1 });
    expect(firstRow.user_id).not.toBe(insert.mock.calls[1][0].user_id);
  });

  it('rejects arbitrary address fields, cross-site writes and ordinary members before service access', async () => {
    expect((await POST(request({ prefectureCode: 13, recipientName: '実名' }))).status).toBe(400);
    expect((await POST(request({ prefectureCode: 13 }, 'https://attacker.example'))).status).toBe(403);
    mocks.getUser.mockResolvedValue({ data: { user: { id: firstId, is_anonymous: false } }, error: null });
    expect((await POST(request({ prefectureCode: 13 }))).status).toBe(403);
    expect(mocks.createCartServiceClient).not.toHaveBeenCalled();
  });
});
