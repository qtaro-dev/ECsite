import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authorizeAdminApi } from '../../src/server/admin/http';

vi.mock('../../src/server/admin/authorization', () => ({
  requireAdminAccess: vi.fn(),
}));
import { requireAdminAccess } from '../../src/server/admin/authorization';

describe('admin API guard', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns a no-store 403 response with a request id for ordinary members', async () => {
    vi.mocked(requireAdminAccess).mockResolvedValue({ kind: 'denied', status: 403 });
    const result = await authorizeAdminApi(new NextRequest('https://shop.example/api/admin/overview'));
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' }, requestId: result.requestId });
  });

  it('rejects cross-origin mutations before querying memberships', async () => {
    const request = new NextRequest('https://shop.example/api/admin/products', {
      method: 'POST', headers: { origin: 'https://attacker.example' },
    });
    const result = await authorizeAdminApi(request, true);
    const response = 'response' in result ? result.response : undefined;
    expect(response?.status).toBe(403);
    expect(requireAdminAccess).not.toHaveBeenCalled();
  });
});
