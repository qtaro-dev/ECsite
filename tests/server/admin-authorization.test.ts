import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { checkAdminAccess, type AdminAccess } from '../../src/server/admin/authorization';

const userId = '9ab65412-8e9a-4d26-a44d-0b5f59cebf2f';
const user = { id: userId };

describe('admin membership authorization', () => {
  it('requires an authenticated user and distinguishes an absent session from auth service failure', async () => {
    await expect(checkAdminAccess({
      getUser: async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } }),
      hasMembership: vi.fn(),
    })).resolves.toEqual({ kind: 'denied', status: 401 });
    await expect(checkAdminAccess({
      getUser: async () => ({ data: { user: null }, error: { message: 'network timeout' } }),
      hasMembership: vi.fn(),
    })).resolves.toEqual({ kind: 'denied', status: 503 });
  });

  it('checks the active membership for this authenticated id on every request', async () => {
    const hasMembership = vi.fn(async (id: string) => ({ data: { user_id: id }, error: null }));
    const result: AdminAccess = await checkAdminAccess({
      getUser: async () => ({ data: { user }, error: null }),
      hasMembership,
    });
    expect(result).toEqual({ kind: 'admin', userId });
    expect(hasMembership).toHaveBeenCalledExactlyOnceWith(userId);
  });

  it('returns 403 for missing or revoked membership and 503 on database failure', async () => {
    const getUser = async () => ({ data: { user }, error: null });
    await expect(checkAdminAccess({ getUser, hasMembership: async () => ({ data: null, error: null }) }))
      .resolves.toEqual({ kind: 'denied', status: 403 });
    await expect(checkAdminAccess({ getUser, hasMembership: async () => ({ data: null, error: new Error('database detail') }) }))
      .resolves.toEqual({ kind: 'denied', status: 503 });
  });
});
