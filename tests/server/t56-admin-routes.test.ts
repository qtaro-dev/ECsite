import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { consumeAdminSetupAttempt, createFirstAdmin, isFirstAdminSetupOpen, isActiveAdmin, auth, createSupabaseServerClient } = vi.hoisted(() => ({
  consumeAdminSetupAttempt: vi.fn(), createFirstAdmin: vi.fn(), isFirstAdminSetupOpen: vi.fn(), isActiveAdmin: vi.fn(),
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() }, createSupabaseServerClient: vi.fn(),
}));
vi.mock('../../src/server/admin/bootstrap', () => ({ consumeAdminSetupAttempt, createFirstAdmin, isFirstAdminSetupOpen, isActiveAdmin }));
vi.mock('../../src/server/auth/supabase', () => ({ createSupabaseServerClient }));

import { GET as setupState, POST as setup } from '../../src/app/api/admin-setup/route';
import { POST as adminLogin } from '../../src/app/api/admin-login/route';

function post(path: string, body: unknown, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '203.0.113.20' }, body: JSON.stringify(body),
  });
}

describe('T56 admin setup and login routes', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    vi.stubEnv('ADMIN_SETUP_CODE', 'a'.repeat(48));
    consumeAdminSetupAttempt.mockResolvedValue(true); createFirstAdmin.mockResolvedValue(true); isFirstAdminSetupOpen.mockResolvedValue(false);
    isActiveAdmin.mockResolvedValue(true); createSupabaseServerClient.mockResolvedValue({ auth });
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: '8c1edcda-3fa8-4e04-9a0b-b240f4d3f035', email_confirmed_at: '2026-09-01T00:00:00Z' } }, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it('reports setup closed and never renders the form state as open after claim', async () => {
    const response = await setupState();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { available: false } });
  });

  it('enforces same-origin and throttles setup attempts before comparing the code', async () => {
    const payload = { email: 'owner@example.test', password: 'a-long-owner-password', setupCode: 'a'.repeat(48) };
    const crossOrigin = await setup(post('/api/admin-setup', payload, 'https://attacker.example'));
    expect(crossOrigin.status).toBe(403);
    expect(consumeAdminSetupAttempt).not.toHaveBeenCalled();
    consumeAdminSetupAttempt.mockResolvedValueOnce(false);
    const limited = await setup(post('/api/admin-setup', payload));
    expect(limited.status).toBe(429);
    expect(createFirstAdmin).not.toHaveBeenCalled();
  });

  it('creates a first owner only with the matching server code and does not return credentials', async () => {
    const payload = { email: 'owner@example.test', password: 'a-long-owner-password', setupCode: 'a'.repeat(48) };
    const wrong = await setup(post('/api/admin-setup', { ...payload, setupCode: 'b'.repeat(48) }));
    expect(wrong.status).toBe(403);
    expect(createFirstAdmin).not.toHaveBeenCalled();
    const response = await setup(post('/api/admin-setup', payload));
    expect(response.status).toBe(201);
    expect(createFirstAdmin).toHaveBeenCalledWith(payload.email, payload.password, expect.any(String));
    const output = await response.text();
    expect(output).not.toContain(payload.password);
    expect(output).not.toContain(payload.setupCode);
  });

  it('signs a non-admin out and returns a clear forbidden result', async () => {
    isActiveAdmin.mockResolvedValue(false);
    const response = await adminLogin(post('/api/admin-login', { email: 'member@example.test', password: 'a-long-member-password' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('このアカウントには管理者権限がありません') } });
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
