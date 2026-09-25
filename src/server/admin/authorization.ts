import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export type AdminAccess = { kind: 'admin'; userId: string } | { kind: 'denied'; status: 401 | 403 | 503 };

type AuthResult = { data: { user: { id: string } | null }; error: { name?: string; code?: string; message?: string } | null };
type MembershipResult = { data: { user_id: string } | null; error: unknown };
type AdminDependencies = {
  getUser: () => Promise<AuthResult>;
  hasMembership: (userId: string) => PromiseLike<MembershipResult>;
};

function missingSession(error: AuthResult['error']): boolean {
  return error?.name === 'AuthSessionMissingError'
    || error?.code === 'session_not_found'
    || error?.message === 'Auth session missing!';
}

export async function checkAdminAccess(dependencies: AdminDependencies): Promise<AdminAccess> {
  let auth: AuthResult;
  try { auth = await dependencies.getUser(); } catch { return { kind: 'denied', status: 503 }; }
  if (auth.error) {
    return { kind: 'denied', status: missingSession(auth.error) ? 401 : 503 };
  }
  if (!auth.data.user) return { kind: 'denied', status: 401 };

  let membership: MembershipResult;
  try { membership = await dependencies.hasMembership(auth.data.user.id); } catch { return { kind: 'denied', status: 503 }; }
  if (membership.error) return { kind: 'denied', status: 503 };
  return membership.data?.user_id === auth.data.user.id
    ? { kind: 'admin', userId: auth.data.user.id }
    : { kind: 'denied', status: 403 };
}

function createAdminMembershipClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Admin authorization database configuration is unavailable');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireAdminAccess(): Promise<AdminAccess> {
  try {
    const supabase = await createSupabaseServerClient();
    let serviceClient: ReturnType<typeof createAdminMembershipClient> | undefined;
    return checkAdminAccess({
      getUser: () => supabase.auth.getUser(),
      hasMembership: (userId) => (serviceClient ??= createAdminMembershipClient()).from('admin_memberships')
        .select('user_id').eq('user_id', userId).is('revoked_at', null).maybeSingle(),
    });
  } catch {
    return { kind: 'denied', status: 503 };
  }
}
