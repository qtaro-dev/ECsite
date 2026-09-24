-- T07: inventory, carts, immutable order snapshots, and payment records.
-- Operational allocation and payment transitions are implemented in later tickets.

create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  on_hand integer not null default 0 check (on_hand >= 0),
  allocated integer not null default 0 check (allocated >= 0 and allocated <= on_hand),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);
create index inventory_allocated_idx on public.inventory(allocated) where allocated > 0;

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_exactly_one_owner check (
    (user_id is not null and anonymous_token_hash is null) or
    (user_id is null and anonymous_token_hash is not null and btrim(anonymous_token_hash) <> '')
  )
);
create unique index carts_user_owner_idx on public.carts(user_id) where user_id is not null;
create unique index carts_anonymous_token_idx on public.carts(anonymous_token_hash) where anonymous_token_hash is not null;

create table public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);
create index cart_items_product_idx on public.cart_items(product_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'payment_pending' check (status in ('payment_pending','paid','payment_failed','expired','review_required')),
  currency char(3) not null default 'JPY' check (currency = 'JPY'),
  goods_total_yen integer not null check (goods_total_yen >= 0),
  shipping_base_yen integer not null check (shipping_base_yen >= 0),
  shipping_heavy_yen integer not null check (shipping_heavy_yen >= 0),
  shipping_total_yen integer not null check (shipping_total_yen >= 0 and shipping_total_yen = shipping_base_yen + shipping_heavy_yen),
  tax_total_yen integer not null check (tax_total_yen >= 0),
  grand_total_yen integer not null check (grand_total_yen >= 0 and grand_total_yen = goods_total_yen + shipping_total_yen),
  tax_rate_basis_points smallint not null default 1000 check (tax_rate_basis_points = 1000),
  shipping_rule_version text not null check (btrim(shipping_rule_version) <> ''),
  origin_snapshot jsonb not null check (jsonb_typeof(origin_snapshot) = 'object'),
  address_snapshot jsonb not null check (jsonb_typeof(address_snapshot) = 'object'),
  compatibility_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(compatibility_snapshot) = 'object'),
  checkout_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint orders_tax_amount_matches_total check (
    tax_total_yen = floor(grand_total_yen::numeric * tax_rate_basis_points / (10000 + tax_rate_basis_points))::integer
  ),
  constraint orders_paid_state_requires_timestamp check (status <> 'paid' or paid_at is not null)
);
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku_snapshot text not null check (btrim(sku_snapshot) <> ''),
  name_snapshot text not null check (btrim(name_snapshot) <> ''),
  brand_snapshot text not null check (btrim(brand_snapshot) <> ''),
  unit_price_yen integer not null check (unit_price_yen >= 0),
  quantity integer not null check (quantity between 1 and 10),
  line_total_yen integer not null check (line_total_yen >= 0 and line_total_yen = unit_price_yen * quantity),
  tax_rate_basis_points smallint not null default 1000 check (tax_rate_basis_points = 1000),
  spec_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(spec_snapshot) = 'object'),
  weight_g_snapshot integer check (weight_g_snapshot is null or weight_g_snapshot > 0),
  pack_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(pack_snapshot) = 'object')
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id) where product_id is not null;

create table public.stock_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity integer not null check (quantity > 0),
  state text not null default 'active' check (state in ('active','consumed','released')),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  constraint stock_allocations_resolution_matches_state check ((state = 'active') = (resolved_at is null)),
  unique (order_id, product_id)
);
create index stock_allocations_state_expiry_idx on public.stock_allocations(state, expires_at);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  state text not null default 'created' check (state in ('created','processing','succeeded','failed','expired','review_required')),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_yen integer not null check (amount_yen >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_no)
);
create unique index payment_attempts_one_open_per_order_idx on public.payment_attempts(order_id)
  where state in ('created','processing','review_required');

create table public.payment_events (
  stripe_event_id text primary key check (btrim(stripe_event_id) <> ''),
  attempt_id uuid references public.payment_attempts(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome in ('processed','ignored','needs_review'))
);
create index payment_events_attempt_received_idx on public.payment_events(attempt_id, received_at);

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  delta integer not null check (delta <> 0),
  reason text not null check (btrim(reason) <> ''),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index inventory_adjustments_product_created_idx on public.inventory_adjustments(product_id, created_at desc);

-- State guards enforce the schema-level state machine. Business conditions such as
-- Stripe verification and atomic inventory changes remain in later tickets.
create or replace function public.guard_order_status_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'payment_pending' and new.status in ('paid','payment_failed','expired','review_required') then return new; end if;
  if old.status = 'review_required' and new.status in ('paid','payment_failed','expired') then return new; end if;
  raise exception 'invalid order status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;
create trigger orders_status_transition_guard before update of status on public.orders
  for each row execute function public.guard_order_status_transition();

create or replace function public.guard_payment_attempt_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if old.state = 'created' and new.state in ('processing','failed','expired','review_required') then return new; end if;
  if old.state = 'processing' and new.state in ('succeeded','failed','expired','review_required') then return new; end if;
  if old.state = 'review_required' and new.state in ('succeeded','failed','expired') then return new; end if;
  raise exception 'invalid payment attempt transition: % -> %', old.state, new.state using errcode = '23514';
end;
$$;
create trigger payment_attempts_state_transition_guard before update of state on public.payment_attempts
  for each row execute function public.guard_payment_attempt_transition();

create or replace function public.guard_stock_allocation_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if old.state = 'active' and new.state in ('consumed','released') then return new; end if;
  raise exception 'invalid stock allocation transition: % -> %', old.state, new.state using errcode = '23514';
end;
$$;
create trigger stock_allocations_state_transition_guard before update of state on public.stock_allocations
  for each row execute function public.guard_stock_allocation_transition();

create or replace function public.prevent_product_delete_with_active_allocation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.stock_allocations where product_id = old.id and state = 'active') then
    raise exception 'cannot delete product with active stock allocation' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger products_active_allocation_delete_guard before delete on public.products
  for each row execute function public.prevent_product_delete_with_active_allocation();

create trigger carts_updated_at before update on public.carts for each row execute function public.set_updated_at();
create trigger inventory_updated_at before update on public.inventory for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger payment_attempts_updated_at before update on public.payment_attempts for each row execute function public.set_updated_at();

-- T07 adds no direct read or write policies. T10 owns member/admin access policies.
alter table public.inventory enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_allocations enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.inventory_adjustments enable row level security;
