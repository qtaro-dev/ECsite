-- T10: member ownership and narrowly scoped administrator reads.
-- All mutations remain on trusted server/database-function paths.

-- Future objects created by the migration owner do not silently become
-- browser-accessible. Current private tables are also explicitly revoked below.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- No directly callable application function is part of the browser contract.
-- Trigger functions continue to run as triggers without caller EXECUTE rights.
revoke execute on all functions in schema public from public, anon, authenticated;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'profiles','admin_memberships','addresses','carts','cart_items','orders','order_items',
    'stock_allocations','payment_attempts','payment_events','inventory','inventory_adjustments',
    'sms_challenges','shipping_settings','smtp_settings','notification_jobs','audit_logs'
  ] loop
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
  end loop;
end $$;

-- Profile fields are limited to the member's display name. Membership rows are
-- never directly visible or writable; private.is_active_admin() is the check.
grant select (user_id, display_name, created_at, updated_at) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_self_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) and (select auth.uid()) is not null);
create policy profiles_self_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) and (select auth.uid()) is not null)
  with check (user_id = (select auth.uid()) and (select auth.uid()) is not null);

grant select, insert, update, delete on public.addresses to authenticated;
create policy addresses_self_select on public.addresses for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy addresses_self_insert on public.addresses for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy addresses_self_update on public.addresses for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy addresses_self_delete on public.addresses for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

-- Browser access is read-only. Anonymous carts remain accessible only through
-- the server's signed-cookie flow; authenticated users see only their own cart.
grant select on public.carts, public.cart_items to authenticated;
create policy carts_self_read on public.carts for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy cart_items_self_read on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id
    and c.user_id = (select auth.uid()) and (select auth.uid()) is not null));

-- Members read their own order tree; admins receive only operational read scopes.
grant select on public.orders, public.order_items, public.payment_attempts to authenticated;
create policy orders_owner_read on public.orders for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy orders_admin_read on public.orders for select to authenticated
  using (private.is_active_admin());
create policy order_items_owner_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
    and o.user_id = (select auth.uid()) and (select auth.uid()) is not null));
create policy order_items_admin_read on public.order_items for select to authenticated
  using (private.is_active_admin());
create policy payment_attempts_owner_read on public.payment_attempts for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
    and o.user_id = (select auth.uid()) and (select auth.uid()) is not null));
create policy payment_attempts_admin_read on public.payment_attempts for select to authenticated
  using (private.is_active_admin());

-- Internal inventory/payment records are admin-readable only. Writes remain
-- reserved for the server transaction functions implemented by later tickets.
grant select on public.inventory, public.stock_allocations, public.payment_events,
  public.inventory_adjustments to authenticated;
create policy inventory_admin_read on public.inventory for select to authenticated
  using (private.is_active_admin());
create policy stock_allocations_admin_read on public.stock_allocations for select to authenticated
  using (private.is_active_admin());
create policy payment_events_admin_read on public.payment_events for select to authenticated
  using (private.is_active_admin());
create policy inventory_adjustments_admin_read on public.inventory_adjustments for select to authenticated
  using (private.is_active_admin());

-- Admin settings/audit are readable for operational work, but challenge and
-- notification payload metadata remain server-only. No client writes here.
grant select on public.shipping_settings, public.smtp_settings, public.audit_logs to authenticated;
create policy shipping_settings_admin_read on public.shipping_settings for select to authenticated
  using (private.is_active_admin());
create policy smtp_settings_admin_read on public.smtp_settings for select to authenticated
  using (private.is_active_admin());
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (private.is_active_admin());

-- Explicitly deny mutation privileges even if a broader grant is introduced
-- elsewhere later. Admin UI/server paths must use reviewed server operations.
revoke insert, update, delete, truncate, references, trigger on public.profiles,
  public.admin_memberships, public.addresses, public.carts, public.cart_items,
  public.orders, public.order_items, public.stock_allocations, public.payment_attempts,
  public.payment_events, public.inventory, public.inventory_adjustments, public.sms_challenges,
  public.shipping_settings, public.smtp_settings, public.notification_jobs, public.audit_logs
  from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert, update, delete on public.addresses to authenticated;
