import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, createSupabaseServerClient } = vi.hoisted(() => ({
  auth: { getUser: vi.fn() }, createSupabaseServerClient: vi.fn(),
}));
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient }));

import { GET, POST, PATCH } from '../../src/app/api/account/addresses/route';
import { DELETE } from '../../src/app/api/account/addresses/[id]/route';

const addressId = 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9';
const address = { recipientName: '山田 太郎', postalCode: '1000001', prefectureCode: 13, city: '千代田区', street: '千代田1-1', isDefault: false };
function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000/api${path}`, {
    method, headers: { origin: 'http://localhost:3000', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const missingSession = Object.assign(new Error('no session'), { name: 'AuthSessionMissingError' });

describe('member address route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServerClient.mockResolvedValue({ auth });
    auth.getUser.mockResolvedValue({ data: { user: null }, error: missingSession });
  });

  it('returns 401 for every operation when the session is absent', async () => {
    const responses = [
      await GET(),
      await POST(request('/account/addresses', 'POST', address)),
      await PATCH(request('/account/addresses', 'PATCH', { addressId, city: '港区' })),
      await DELETE(request(`/account/addresses/${addressId}`, 'DELETE'), { params: Promise.resolve({ id: addressId }) }),
    ];
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    for (const response of responses) expect(JSON.parse(await response.text()).error.code).toBe('UNAUTHORIZED');
  });

  it('keeps actual session lookup failures as 503', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('provider unavailable') });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.parse(await response.text()).error.code).toBe('UNAVAILABLE');
  });

  it('rejects cross-site mutations before calling Supabase', async () => {
    const response = await POST(new NextRequest('http://localhost:3000/api/account/addresses', {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify(address),
    }));
    expect(response.status).toBe(403);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
