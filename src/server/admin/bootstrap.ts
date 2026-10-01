import 'server-only';
import { createClient } from '@supabase/supabase-js';

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Admin setup database configuration unavailable');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function isFirstAdminSetupOpen(): Promise<boolean> {
  const supabase = client();
  const [claim, membership] = await Promise.all([
    supabase.from('admin_setup_claim').select('id').eq('id', 1).maybeSingle(),
    supabase.from('admin_memberships').select('user_id', { count: 'exact', head: true }),
  ]);
  if (claim.error || membership.error) throw new Error('Admin setup state unavailable');
  return !claim.data && membership.count === 0;
}

export async function consumeAdminSetupAttempt(bucketHash: string): Promise<boolean> {
  const { data, error } = await client().rpc('consume_admin_setup_attempt', { p_bucket_hash: bucketHash });
  if (error || typeof data !== 'boolean') throw new Error('Admin setup rate limit unavailable');
  return data;
}

export async function isActiveAdmin(userId: string): Promise<boolean> {
  const { data, error } = await client().from('admin_memberships').select('user_id')
    .eq('user_id', userId).is('revoked_at', null).maybeSingle();
  if (error) throw new Error('Admin membership lookup unavailable');
  return data?.user_id === userId;
}

export async function createFirstAdmin(email: string, password: string, requestId: string): Promise<boolean> {
  const supabase = client();
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error('Could not create initial owner');
  const userId = data.user.id;
  const grant = await supabase.rpc('bootstrap_first_admin', { p_user_id: userId, p_request_id: requestId });
  if (grant.error || grant.data !== true) {
    // Only delete the user created by this request. Never delete an existing account.
    await supabase.auth.admin.deleteUser(userId);
    if (grant.error) throw new Error('Could not grant initial admin membership');
    return false;
  }
  return true;
}
