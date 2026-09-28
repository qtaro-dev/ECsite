import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), createSupabaseServerClient: vi.fn(), createCartServiceClient: vi.fn(),
  requestDemoDeletion: vi.fn(), claimDemoDeletion: vi.fn(), processDemoDeletion: vi.fn(),
}));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/account/demo-retention', () => ({
  requestDemoDeletion: mocks.requestDemoDeletion, claimDemoDeletion: mocks.claimDemoDeletion,
  processDemoDeletion: mocks.processDemoDeletion,
}));

import { POST } from '../../src/app/api/account/delete/route';

const userId = '00000000-0000-4000-8000-000000000522';
function request(body: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/account/delete', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('demo account deletion API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: true } }, error: null });
    mocks.createCartServiceClient.mockReturnValue({});
    mocks.requestDemoDeletion.mockResolvedValue(true);
    mocks.claimDemoDeletion.mockResolvedValue([userId]);
    mocks.processDemoDeletion.mockResolvedValue('deleted');
  });

  it('requires same Origin, exact confirmation and a verified anonymous Auth user', async () => {
    expect((await POST(request({ confirmation: 'アカウントを削除' }, 'https://attacker.example'))).status).toBe(403);
    expect((await POST(request({ confirmation: 'はい' }))).status).toBe(400);
    expect((await POST(request({ confirmation: 'アカウントを削除', reauthenticated: true }))).status).toBe(400);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request({ confirmation: 'アカウントを削除' }))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null });
    expect((await POST(request({ confirmation: 'アカウントを削除' }))).status).toBe(403);
    expect(mocks.createCartServiceClient).not.toHaveBeenCalled();
  });

  it('deletes safe demo data immediately and queues unresolved payment for retry', async () => {
    const done = await POST(request({ confirmation: 'アカウントを削除' }));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ data: { status: 'deleted' } });
    expect(mocks.requestDemoDeletion).toHaveBeenCalledWith(expect.anything(), userId);
    mocks.processDemoDeletion.mockResolvedValueOnce('deferred');
    const pending = await POST(request({ confirmation: 'アカウントを削除' }));
    expect(pending.status).toBe(202);
    expect(await pending.json()).toMatchObject({ data: { status: 'deferred' } });
  });
});
