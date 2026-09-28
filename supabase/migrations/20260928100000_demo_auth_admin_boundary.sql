-- T50: anonymous Auth sessions are authenticated members, but never admins.
-- The JWT guard also prevents an accidentally granted anonymous account
-- from gaining administrative RLS reads.
create or replace function private.is_active_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.admin_memberships m
      where m.user_id = (select auth.uid()) and m.revoked_at is null);
$$;
revoke all on function private.is_active_admin() from public, anon, authenticated;
grant execute on function private.is_active_admin() to authenticated;
