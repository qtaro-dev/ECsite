import { describe, expect, it, vi } from 'vitest';
import { startDemoSession } from '../../src/features/auth/DemoStart';

describe('demo start orchestration', () => {
  it('reuses an existing signed session and merges the anonymous cart once', async () => {
    const signInAnonymously = vi.fn();
    const merge = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await startDemoSession({ getUser: vi.fn(async () => ({ data: { user: { id: 'existing' } }, error: null })), signInAnonymously } as never, merge);
    expect(result).toEqual({ ok: true, mergeWarning: false });
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledOnce();
  });
  it('creates a new session only for a missing session and invokes the owner-checked merge', async () => {
    const signInAnonymously = vi.fn(async () => ({ data: { user: { id: 'new' } }, error: null }));
    const merge = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await startDemoSession({ getUser: vi.fn(async () => ({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })), signInAnonymously } as never, merge);
    expect(result).toEqual({ ok: true, mergeWarning: false });
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(merge).toHaveBeenCalledOnce();
  });
  it('reports provider failures without merging and retains a signed session if merge fails', async () => {
    const merge = vi.fn(async () => new Response('{}', { status: 503 }));
    const providerError = await startDemoSession({ getUser: vi.fn(async () => ({ data: { user: null }, error: null })), signInAnonymously: vi.fn(async () => ({ data: { user: null }, error: { code: 'over_request_rate_limit', status: 429 } })) } as never, merge);
    expect(providerError).toMatchObject({ ok: false });
    expect(merge).not.toHaveBeenCalled();
    const mergeError = await startDemoSession({ getUser: vi.fn(async () => ({ data: { user: { id: 'existing' } }, error: null })), signInAnonymously: vi.fn() } as never, merge);
    expect(mergeError).toEqual({ ok: true, mergeWarning: true });
  });
});
