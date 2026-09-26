-- T30: give a new allocation enough time for the minimum Stripe Checkout
-- Session lifetime, then persist or safely compensate Session creation via
-- atomic service-only RPCs. The original T29 migration remains immutable.

-- Keep the T29 implementation as a private implementation detail. The public
-- RPC wrapper below adjusts only newly created rows; idempotent replays never
-- extend an existing hold.
alter function public.create_checkout_order(uuid,uuid,uuid,jsonb)
  rename to create_checkout_order_t29_internal;
revoke all on function public.create_checkout_order_t29_internal(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

create function public.create_checkout_order(
  p_user_id uuid,
  p_quote_id uuid,
  p_checkout_key uuid,
  p_current_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_attempt_id uuid;
  v_created_at timestamptz;
  v_expiry timestamptz;
  v_rows integer;
begin
  v_result := public.create_checkout_order_t29_internal(
    p_user_id,p_quote_id,p_checkout_key,p_current_snapshot);
  if v_result->>'status' <> 'created' then
    return v_result;
  end if;

  v_order_id := (v_result->>'orderId')::uuid;
  v_attempt_id := (v_result->>'attemptId')::uuid;
  select o.created_at into v_created_at from public.orders o where o.id=v_order_id;
  if not found or v_attempt_id is null then
    raise exception 'T30 newly created checkout rows are incomplete' using errcode='23514';
  end if;
  v_expiry := v_created_at + interval '35 minutes';

  update public.stock_allocations sa set expires_at=v_expiry
    where sa.order_id=v_order_id and sa.state='active';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'T30 new checkout has no active stock allocation' using errcode='23514';
  end if;
  update public.payment_attempts pa set expires_at=v_expiry
    where pa.id=v_attempt_id and pa.order_id=v_order_id and pa.state='created';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'T30 new checkout payment attempt is incomplete' using errcode='23514';
  end if;

  return v_result || pg_catalog.jsonb_build_object('expiresAt',v_expiry);
end;
$$;
revoke all on function public.create_checkout_order(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_checkout_order(uuid,uuid,uuid,jsonb) to service_role;
comment on function public.create_checkout_order(uuid,uuid,uuid,jsonb) is
  'Service-only atomic checkout creation. New payment attempts and active stock allocations expire 35 minutes after order creation; idempotent replays do not extend the hold.';

alter table public.payment_attempts
  add column stripe_session_expires_at bigint,
  add column stripe_session_site_origin text,
  add constraint payment_attempts_stripe_request_pair check (
    (stripe_session_expires_at is null and stripe_session_site_origin is null)
    or (stripe_session_expires_at is not null and stripe_session_site_origin is not null
      and stripe_session_expires_at > 0 and pg_catalog.btrim(stripe_session_site_origin) <> '')
  );
comment on column public.payment_attempts.stripe_session_expires_at is
  'Frozen absolute Stripe Checkout expires_at (Unix seconds), prepared before the first SDK call for idempotent retries.';
comment on column public.payment_attempts.stripe_session_site_origin is
  'Frozen canonical return origin used with stripe_session_expires_at for exact Stripe idempotent retries.';

create function public.checkout_session_prepare(
  p_order_id uuid,
  p_attempt_id uuid,
  p_site_origin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_attempt_state text;
  v_session_id text;
  v_allocation_expires_at timestamptz;
  v_expiry bigint;
  v_origin text;
  v_active_count integer;
  v_allocation_count integer;
  v_rows integer;
begin
  if p_order_id is null or p_attempt_id is null or p_site_origin is null
     or pg_catalog.length(p_site_origin)>2048 or pg_catalog.btrim(p_site_origin)=''
     or p_site_origin !~ '^https?://[^/?#@]+/?$' then
    return pg_catalog.jsonb_build_object('status','invalid_parameters');
  end if;
  select o.status into v_order_status from public.orders o where o.id=p_order_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status','not_found');
  end if;
  select pa.state,pa.stripe_session_id,pa.expires_at,pa.stripe_session_expires_at,pa.stripe_session_site_origin
    into v_attempt_state,v_session_id,v_allocation_expires_at,v_expiry,v_origin
    from public.payment_attempts pa where pa.order_id=p_order_id and pa.id=p_attempt_id for update;
  if not found then return pg_catalog.jsonb_build_object('status','not_found'); end if;
  if v_order_status<>'payment_pending' or v_attempt_state not in ('created','processing') then
    return pg_catalog.jsonb_build_object('status','not_pending');
  end if;
  if v_allocation_expires_at<=pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('status','allocation_window_elapsed');
  end if;
  -- T32 and payment-state RPCs lock the order first, then allocation rows in
  -- product-id order, then inventory, to serialize expiry/release safely.
  perform sa.id from public.stock_allocations sa where sa.order_id=p_order_id
    order by sa.product_id for update;
  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where sa.state='active')::integer
    into v_allocation_count,v_active_count
    from public.stock_allocations sa where sa.order_id=p_order_id;
  if v_allocation_count=0 or v_active_count<>v_allocation_count then
    return pg_catalog.jsonb_build_object('status','allocation_unavailable');
  end if;
  if v_expiry is not null then
    if v_origin<>p_site_origin then
      return pg_catalog.jsonb_build_object('status','parameters_conflict');
    end if;
    if v_expiry<=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint then
      return pg_catalog.jsonb_build_object('status','session_expired');
    end if;
    return pg_catalog.jsonb_build_object('status','already_prepared',
      'expiresAtEpochSeconds',v_expiry,'siteOrigin',v_origin);
  end if;
  if v_session_id is not null then
    return pg_catalog.jsonb_build_object('status','parameters_conflict');
  end if;

  -- Freeze the first absolute Session expiry and return origin. Retries use
  -- these exact Stripe parameters; later retries cannot move expires_at.
  v_expiry := pg_catalog.ceil(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint + 1810;
  if v_expiry>pg_catalog.floor(pg_catalog.date_part('epoch',v_allocation_expires_at))::bigint then
    return pg_catalog.jsonb_build_object('status','allocation_window_elapsed');
  end if;
  update public.payment_attempts pa
    set stripe_session_expires_at=v_expiry,stripe_session_site_origin=p_site_origin
    where pa.id=p_attempt_id and pa.stripe_session_expires_at is null;
  get diagnostics v_rows = row_count;
  if v_rows<>1 then
    raise exception 'T30 Session parameters changed while preparing' using errcode='23514';
  end if;
  return pg_catalog.jsonb_build_object('status','prepared',
    'expiresAtEpochSeconds',v_expiry,'siteOrigin',p_site_origin);
end;
$$;
revoke all on function public.checkout_session_prepare(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.checkout_session_prepare(uuid,uuid,text) to service_role;
comment on function public.checkout_session_prepare(uuid,uuid,text) is
  'Service-only atomic freeze of Stripe Session expires_at and return origin before the external API call. Exact parameters are reused on retries.';

create function public.checkout_session_record(
  p_order_id uuid,
  p_attempt_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_attempt_state text;
  v_order_amount integer;
  v_attempt_amount integer;
  v_existing_session text;
  v_amount_matches boolean;
  v_allocation_expires_at timestamptz;
  v_session_expires_at bigint;
  v_allocation_count integer;
  v_active_count integer;
begin
  if p_order_id is null or p_attempt_id is null or p_session_id is null
     or pg_catalog.length(p_session_id)>255
     or p_session_id !~ '^cs_test_[A-Za-z0-9_]+$' then
    return pg_catalog.jsonb_build_object('status','invalid_session_id');
  end if;

  select o.status,o.grand_total_yen into v_order_status,v_order_amount
    from public.orders o where o.id=p_order_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status','not_found');
  end if;
  select pa.state,pa.stripe_session_id,pa.amount_yen,pa.expires_at,pa.stripe_session_expires_at
    into v_attempt_state,v_existing_session,v_attempt_amount,v_allocation_expires_at,v_session_expires_at
    from public.payment_attempts pa where pa.order_id=p_order_id and pa.id=p_attempt_id for update;
  if not found then return pg_catalog.jsonb_build_object('status','not_found'); end if;
  v_amount_matches := v_attempt_amount=v_order_amount;
  if v_order_status<>'payment_pending' or v_attempt_state not in ('created','processing') then
    return pg_catalog.jsonb_build_object('status','not_pending');
  end if;
  if v_allocation_expires_at<=pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('status','allocation_elapsed');
  end if;
  if v_session_expires_at is null then
    return pg_catalog.jsonb_build_object('status','parameters_unprepared');
  end if;
  if v_session_expires_at<=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint then
    return pg_catalog.jsonb_build_object('status','session_expired');
  end if;
  if v_amount_matches is not true then
    return pg_catalog.jsonb_build_object('status','amount_conflict');
  end if;
  perform sa.id from public.stock_allocations sa where sa.order_id=p_order_id
    order by sa.product_id for update;
  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where sa.state='active')::integer
    into v_allocation_count,v_active_count
    from public.stock_allocations sa where sa.order_id=p_order_id;
  if v_allocation_count=0 or v_active_count<>v_allocation_count then
    return pg_catalog.jsonb_build_object('status','allocation_unavailable');
  end if;
  if v_existing_session is not null then
    if v_existing_session=p_session_id then
      return pg_catalog.jsonb_build_object('status','already_stored');
    end if;
    return pg_catalog.jsonb_build_object('status','session_conflict');
  end if;
  update public.payment_attempts pa
    set stripe_session_id=p_session_id,state='processing'
    where pa.id=p_attempt_id;
  return pg_catalog.jsonb_build_object('status','stored');
end;
$$;
revoke all on function public.checkout_session_record(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.checkout_session_record(uuid,uuid,text) to service_role;
comment on function public.checkout_session_record(uuid,uuid,text) is
  'Service-only atomic persistence of a Stripe test Checkout Session id and transition to processing. Same-id retries are idempotent; conflicting ids are rejected.';

create function public.checkout_session_creation_failed(
  p_order_id uuid,
  p_attempt_id uuid,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_attempt_state text;
  v_session_id text;
  v_allocation_expires_at timestamptz;
  v_session_expires_at bigint;
  v_allocation record;
  v_active_count integer;
  v_rows integer;
begin
  if p_order_id is null or p_attempt_id is null or p_failure_code is null
     or p_failure_code not in ('stripe_rejected','allocation_window_elapsed') then
    return pg_catalog.jsonb_build_object('status','not_pending');
  end if;

  select o.status into v_order_status from public.orders o where o.id=p_order_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status','not_found');
  end if;
  select pa.state,pa.stripe_session_id,pa.expires_at
    into v_attempt_state,v_session_id,v_allocation_expires_at
    from public.payment_attempts pa where pa.order_id=p_order_id and pa.id=p_attempt_id for update;
  if not found then return pg_catalog.jsonb_build_object('status','not_found'); end if;
  if v_order_status='paid' or v_attempt_state='succeeded' then
    return pg_catalog.jsonb_build_object('status','already_paid');
  end if;
  if v_session_id is not null then
    return pg_catalog.jsonb_build_object('status','session_exists');
  end if;

  perform sa.id from public.stock_allocations sa where sa.order_id=p_order_id
    order by sa.product_id for update;
  select pg_catalog.count(*)::integer into v_active_count
    from public.stock_allocations sa where sa.order_id=p_order_id and sa.state='active';
  if v_order_status in ('payment_failed','expired')
     and v_attempt_state in ('failed','expired') and v_active_count=0 then
    return pg_catalog.jsonb_build_object('status','already_released');
  end if;
  if v_order_status<>'payment_pending' or v_attempt_state not in ('created','processing') then
    return pg_catalog.jsonb_build_object('status','not_pending');
  end if;
  if v_active_count=0 then
    return pg_catalog.jsonb_build_object('status','not_pending');
  end if;

  -- Serialize releases by product id, matching T29's inventory lock order.
  for v_allocation in
    select sa.id,sa.product_id,sa.quantity
      from public.stock_allocations sa
      where sa.order_id=p_order_id and sa.state='active'
      order by sa.product_id
      for update
  loop
    if v_allocation.product_id is null then
      raise exception 'T30 active allocation has no product' using errcode='23514';
    end if;
    update public.inventory i
      set allocated=i.allocated-v_allocation.quantity,version=i.version+1
      where i.product_id=v_allocation.product_id and i.allocated>=v_allocation.quantity;
    get diagnostics v_rows = row_count;
    if v_rows<>1 then
      raise exception 'T30 active allocation exceeds inventory allocated quantity' using errcode='23514';
    end if;
    update public.stock_allocations sa
      set state='released',resolved_at=pg_catalog.clock_timestamp()
      where sa.id=v_allocation.id and sa.state='active';
    get diagnostics v_rows = row_count;
    if v_rows<>1 then
      raise exception 'T30 active allocation changed while releasing' using errcode='23514';
    end if;
  end loop;

  update public.payment_attempts pa set state='failed'
    where pa.id=p_attempt_id and pa.state in ('created','processing');
  get diagnostics v_rows = row_count;
  if v_rows<>1 then
    raise exception 'T30 payment attempt changed while releasing' using errcode='23514';
  end if;
  update public.orders o set status='payment_failed'
    where o.id=p_order_id and o.status='payment_pending';
  get diagnostics v_rows = row_count;
  if v_rows<>1 then
    raise exception 'T30 order changed while releasing' using errcode='23514';
  end if;
  return pg_catalog.jsonb_build_object('status','released');
end;
$$;
revoke all on function public.checkout_session_creation_failed(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.checkout_session_creation_failed(uuid,uuid,text) to service_role;
comment on function public.checkout_session_creation_failed(uuid,uuid,text) is
  'Service-only atomic definitive Session creation failure. Refuses compensation after a Session id exists; otherwise fails the order and attempt and releases active allocations.';
