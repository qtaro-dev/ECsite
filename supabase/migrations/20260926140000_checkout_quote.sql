-- T28: persist the formal quote for at most 15 minutes. Address contents are
-- intentionally not copied; T29 must validate address ownership and recalculate.
create table public.checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address_id uuid not null references public.addresses(id) on delete cascade,
  items_snapshot jsonb not null,
  goods_total_yen integer not null check (goods_total_yen >= 0),
  shipping_base_yen integer not null check (shipping_base_yen >= 0),
  shipping_heavy_yen integer not null check (shipping_heavy_yen >= 0),
  tax_rate_basis_points smallint not null default 1000 check (tax_rate_basis_points = 1000),
  tax_total_yen integer not null check (tax_total_yen >= 0),
  grand_total_yen integer not null check (grand_total_yen >= 0),
  shipping_settings_version text not null check (length(btrim(shipping_settings_version)) > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  constraint checkout_quotes_snapshot_array check (
    case when jsonb_typeof(items_snapshot) = 'array' then jsonb_array_length(items_snapshot) > 0 else false end
  ),
  constraint checkout_quotes_grand_total check (grand_total_yen = goods_total_yen + shipping_base_yen + shipping_heavy_yen),
  constraint checkout_quotes_tax check (tax_total_yen = floor(grand_total_yen::numeric * tax_rate_basis_points / (10000 + tax_rate_basis_points))::integer),
  constraint checkout_quotes_expiry check (expires_at = created_at + interval '15 minutes')
);

create index checkout_quotes_user_expiry_idx on public.checkout_quotes(user_id, expires_at);
create index checkout_quotes_expiry_idx on public.checkout_quotes(expires_at);

alter table public.checkout_quotes enable row level security;
alter table public.checkout_quotes force row level security;
create policy checkout_quotes_service_role on public.checkout_quotes
  for all to service_role using (true) with check (true);
revoke all on public.checkout_quotes from public, anon, authenticated;
grant select, insert, update, delete on public.checkout_quotes to service_role;

comment on table public.checkout_quotes is
  'Short-lived formal checkout quote snapshot. Contains no address body and is accessible only to trusted server service_role.';
comment on column public.checkout_quotes.items_snapshot is
  'Server-calculated product IDs, quantities, current unit prices, and line totals; T29 re-reads current product/inventory data.';

-- A fixed window bounds repeated quote recalculations per member. Five attempts
-- per 60 seconds is the default operational guard until a shared limiter exists.
create table public.checkout_quote_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);
create index checkout_quote_rate_limits_window_idx on public.checkout_quote_rate_limits(window_started_at);
alter table public.checkout_quote_rate_limits enable row level security;
alter table public.checkout_quote_rate_limits force row level security;
revoke all on public.checkout_quote_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.checkout_quote_rate_limits to service_role;

create or replace function public.checkout_quote_rate_limit(p_user_id uuid)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_started timestamptz;
  v_count integer;
  v_limit constant integer := 5;
  v_window constant interval := interval '60 seconds';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'member id required';
  end if;

  insert into public.checkout_quote_rate_limits as current_limit(user_id, window_started_at, request_count)
  values (p_user_id, v_now, 1)
  on conflict (user_id) do update set
    window_started_at = case
      when current_limit.window_started_at + v_window <= v_now then v_now
      else current_limit.window_started_at end,
    request_count = case
      when current_limit.window_started_at + v_window <= v_now then 1
      else current_limit.request_count + 1 end
  returning window_started_at, request_count into v_started, v_count;

  return query select v_count <= v_limit,
    case when v_count <= v_limit then 0
      else greatest(1, ceil(extract(epoch from (v_started + v_window - v_now)))::integer) end;
end;
$$;

revoke all on function public.checkout_quote_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.checkout_quote_rate_limit(uuid) to service_role;
comment on function public.checkout_quote_rate_limit(uuid) is
  'Atomically allows at most five checkout quote requests per member in a fixed 60-second window.';
