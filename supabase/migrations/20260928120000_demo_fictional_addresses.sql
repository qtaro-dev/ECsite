-- T51: signed anonymous Auth sessions can read only their own addresses.
-- Only the server's service role may provision the fixed fictional fixture.
create unique index addresses_demo_fixture_per_region_idx on public.addresses(user_id, prefecture_code)
  where recipient_name = 'デモ購入者' and postal_code = '0000000'
    and city = '架空市' and street = 'デモ専用1番地' and building is null;

drop policy addresses_self_insert on public.addresses;
create policy addresses_self_insert on public.addresses for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid())
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

drop policy addresses_self_update on public.addresses;
create policy addresses_self_update on public.addresses for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid())
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
  with check ((select auth.uid()) is not null and user_id = (select auth.uid())
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

drop policy addresses_self_delete on public.addresses;
create policy addresses_self_delete on public.addresses for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid())
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
