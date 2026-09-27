-- T32 claims due payment attempts with a short lease so overlapping Cron runs
-- do not repeat Stripe reads. State and inventory changes remain atomic below.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

alter table public.payment_attempts
  add column reconciliation_next_attempt_at timestamptz,
  add column reconciliation_attempt_count integer not null default 0
    check (reconciliation_attempt_count >= 0);

create index payment_attempts_reconciliation_due_idx
  on public.payment_attempts(reconciliation_next_attempt_at,expires_at,id)
  where stripe_session_id is not null or state in ('created','processing','failed','expired','review_required');

create function public.claim_expired_checkout_attempts(p_limit integer default 3)
returns table(order_id uuid,attempt_id uuid,session_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 3 then
    raise exception 'invalid reconciliation batch size' using errcode='22023';
  end if;

  return query
  with due as (
    select pa.id
      from public.payment_attempts pa
      join public.orders o on o.id=pa.order_id
      where pa.expires_at<=pg_catalog.clock_timestamp()
        and (pa.reconciliation_next_attempt_at is null
          or pa.reconciliation_next_attempt_at<=pg_catalog.clock_timestamp())
        and o.status in ('payment_pending','review_required','payment_failed','expired')
        and pa.state in ('created','processing','failed','expired','review_required')
        and (o.status='payment_pending' or exists (select 1 from public.stock_allocations sa
          where sa.order_id=pa.order_id and sa.state='active'))
      order by pa.expires_at,pa.id
      for update of pa skip locked
      limit p_limit
  ), leased as (
    update public.payment_attempts pa
       set reconciliation_next_attempt_at=pg_catalog.clock_timestamp()+interval '5 minutes',
           reconciliation_attempt_count=pa.reconciliation_attempt_count+1
      from due d
     where pa.id=d.id
    returning pa.order_id,pa.id,pa.stripe_session_id
  )
  select l.order_id,l.id,l.stripe_session_id from leased l order by l.order_id,l.id;
end;
$$;
revoke all on function public.claim_expired_checkout_attempts(integer) from public,anon,authenticated;
grant execute on function public.claim_expired_checkout_attempts(integer) to service_role;

create function public.apply_checkout_reconciliation(
  p_order_id uuid,
  p_attempt_id uuid,
  p_result text,
  p_session_id text,
  p_session_mode text,
  p_livemode boolean,
  p_session_status text,
  p_payment_status text,
  p_amount_total_yen integer,
  p_currency text,
  p_session_created_at bigint,
  p_session_expires_at bigint,
  p_session_order_id text,
  p_session_attempt_id text,
  p_payment_intent_id text,
  p_payment_intent_status text,
  p_payment_intent_amount integer,
  p_payment_intent_amount_received integer,
  p_payment_intent_currency text,
  p_payment_intent_order_id text,
  p_payment_intent_attempt_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_order_currency text;
  v_order_amount integer;
  v_attempt_state text;
  v_attempt_amount integer;
  v_attempt_expires_at timestamptz;
  v_stored_session_id text;
  v_stored_payment_intent_id text;
  v_frozen_session_expiry bigint;
  v_allocation_count integer;
  v_active_count integer;
  v_bad_inventory_count integer;
  v_allocation record;
  v_rows integer;
  v_facts_valid boolean;
begin
  if p_order_id is null or p_attempt_id is null then
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  -- Shared lock contract: order, attempt, allocation rows by product id,
  -- then inventory rows by product id. T31 webhook and T32 Cron serialize here.
  select o.status,o.currency,o.grand_total_yen
    into v_order_status,v_order_currency,v_order_amount
    from public.orders o where o.id=p_order_id for update;
  if not found then return pg_catalog.jsonb_build_object('status','needs_review'); end if;
  select pa.state,pa.amount_yen,pa.expires_at,pa.stripe_session_id,pa.stripe_payment_intent_id,pa.stripe_session_expires_at
    into v_attempt_state,v_attempt_amount,v_attempt_expires_at,v_stored_session_id,v_stored_payment_intent_id,v_frozen_session_expiry
    from public.payment_attempts pa where pa.id=p_attempt_id and pa.order_id=p_order_id for update;
  if not found then return pg_catalog.jsonb_build_object('status','needs_review'); end if;

  if v_order_status='paid' and v_attempt_state='succeeded' then
    return pg_catalog.jsonb_build_object('status','already_paid');
  end if;
  if v_attempt_expires_at>pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('status','not_due');
  end if;

  if p_result is null or p_result not in ('succeeded','failed','expired','pending','unavailable') then
    p_result := 'unavailable';
  end if;
  if p_result in ('pending','unavailable') then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  perform sa.id from public.stock_allocations sa
    where sa.order_id=p_order_id order by sa.product_id,sa.id for update;
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where sa.state='active')::integer
    into v_allocation_count,v_active_count
    from public.stock_allocations sa where sa.order_id=p_order_id;

  v_facts_valid := p_session_id is not null
    and p_session_id ~ '^cs_test_[A-Za-z0-9_]+$'
    and p_session_id=v_stored_session_id
    and p_session_mode='payment' and p_livemode is false
    and p_session_status in ('open','complete','expired')
    and p_payment_status in ('paid','unpaid','no_payment_required')
    and p_amount_total_yen=v_order_amount and v_attempt_amount=v_order_amount
    and v_order_currency='JPY'
    and pg_catalog.lower(pg_catalog.btrim(v_order_currency))=pg_catalog.lower(p_currency)
    and p_session_created_at is not null and p_session_expires_at is not null
    and p_session_expires_at>p_session_created_at
    and p_session_expires_at=v_frozen_session_expiry
    and pg_catalog.to_timestamp(p_session_expires_at)<=v_attempt_expires_at
    and p_session_order_id=p_order_id::text and p_session_attempt_id=p_attempt_id::text
    and (p_payment_intent_id is null or p_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$')
    and (v_stored_payment_intent_id is null or p_payment_intent_id=v_stored_payment_intent_id)
    and (p_payment_intent_id is null or (
      p_payment_intent_amount=v_order_amount
      and p_payment_intent_currency is not null and pg_catalog.lower(p_payment_intent_currency)='jpy'
      and p_payment_intent_order_id=p_order_id::text
      and p_payment_intent_attempt_id=p_attempt_id::text
    ));

  if v_facts_valid is not true then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  if p_result='succeeded' then
    if p_session_status is distinct from 'complete' or p_payment_status is distinct from 'paid'
       or p_payment_intent_id is null or p_payment_intent_status is distinct from 'succeeded'
       or p_payment_intent_amount_received is distinct from v_order_amount then
      update public.payment_attempts set state='review_required'
        where id=p_attempt_id and state in ('created','processing','failed','expired');
      update public.orders set status='review_required'
        where id=p_order_id and status in ('payment_pending','payment_failed','expired');
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    if v_order_status not in ('payment_pending','review_required','payment_failed','expired')
       or v_attempt_state not in ('created','processing','review_required','failed','expired')
       or (v_order_status in ('payment_failed','expired') and v_attempt_state not in ('failed','expired','review_required'))
       or (v_attempt_state in ('failed','expired') and v_order_status not in ('payment_failed','expired','review_required')) then
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    if v_allocation_count=0 or v_active_count<>v_allocation_count then
      update public.payment_attempts set state='review_required'
        where id=p_attempt_id and state in ('created','processing','failed','expired');
      update public.orders set status='review_required'
        where id=p_order_id and status in ('payment_pending','payment_failed','expired');
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    perform i.product_id from public.inventory i
      join public.stock_allocations sa on sa.product_id=i.product_id
      where sa.order_id=p_order_id and sa.state='active'
      order by i.product_id for update of i;
    select pg_catalog.count(*)::integer into v_bad_inventory_count
      from public.stock_allocations sa left join public.inventory i on i.product_id=sa.product_id
      where sa.order_id=p_order_id and sa.state='active'
        and (sa.product_id is null or i.product_id is null or i.on_hand<sa.quantity or i.allocated<sa.quantity);
    if v_bad_inventory_count<>0 then
      update public.payment_attempts set state='review_required'
        where id=p_attempt_id and state in ('created','processing','failed','expired');
      update public.orders set status='review_required'
        where id=p_order_id and status in ('payment_pending','payment_failed','expired');
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    -- `created` with a persisted Session is not emitted by T30, which records
    -- both the Session and `processing` state atomically. Recover safely if an
    -- older/inconsistent row appears by taking the allowed transition first.
    if v_attempt_state='created' then
      update public.payment_attempts set state='processing' where id=p_attempt_id;
      v_attempt_state := 'processing';
    end if;
    for v_allocation in select sa.id,sa.product_id,sa.quantity from public.stock_allocations sa
      where sa.order_id=p_order_id and sa.state='active' order by sa.product_id,sa.id for update loop
      update public.inventory set on_hand=on_hand-v_allocation.quantity,
        allocated=allocated-v_allocation.quantity,version=version+1
        where product_id=v_allocation.product_id;
      update public.stock_allocations set state='consumed',resolved_at=pg_catalog.clock_timestamp()
        where id=v_allocation.id and state='active';
    end loop;
    update public.payment_attempts set state='succeeded',stripe_payment_intent_id=p_payment_intent_id
      where id=p_attempt_id;
    update public.orders set status='paid',paid_at=pg_catalog.clock_timestamp() where id=p_order_id;
    return pg_catalog.jsonb_build_object('status','processed');
  end if;

    if (p_result='failed' and (p_session_status is distinct from 'complete'
        or p_payment_status is distinct from 'unpaid' or p_payment_intent_id is null
        or p_payment_intent_status is null
        or p_payment_intent_status not in ('requires_payment_method','canceled')
        or p_payment_intent_amount_received is distinct from 0))
     or (p_result='expired' and (p_session_status is distinct from 'expired'
        or p_payment_status is distinct from 'unpaid'
        or (p_payment_intent_id is not null and p_payment_intent_status is null)
        or (p_payment_intent_id is not null and p_payment_intent_amount_received is distinct from 0)
        or (p_payment_intent_status is not null and p_payment_intent_status in ('succeeded','processing','requires_action','requires_confirmation','requires_capture')))) then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  if p_result not in ('failed','expired') then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  if v_order_status in ('payment_failed','expired') and v_active_count=0
     and ((v_order_status='payment_failed' and v_attempt_state='failed')
       or (v_order_status='expired' and v_attempt_state='expired')) then
    return pg_catalog.jsonb_build_object('status','already_resolved');
  end if;
  if v_order_status not in ('payment_pending','review_required')
     or v_attempt_state not in ('created','processing','review_required') then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  if v_allocation_count=0 or v_active_count<>v_allocation_count then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  perform i.product_id from public.inventory i
    join public.stock_allocations sa on sa.product_id=i.product_id
    where sa.order_id=p_order_id and sa.state='active'
    order by i.product_id for update of i;
  select pg_catalog.count(*)::integer into v_bad_inventory_count
    from public.stock_allocations sa left join public.inventory i on i.product_id=sa.product_id
    where sa.order_id=p_order_id and sa.state='active'
      and (sa.product_id is null or i.product_id is null or i.allocated<sa.quantity);
  if v_bad_inventory_count<>0 then
    update public.payment_attempts set state='review_required'
      where id=p_attempt_id and state in ('created','processing','failed','expired');
    update public.orders set status='review_required'
      where id=p_order_id and status in ('payment_pending','payment_failed','expired');
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  for v_allocation in select sa.id,sa.product_id,sa.quantity from public.stock_allocations sa
    where sa.order_id=p_order_id and sa.state='active' order by sa.product_id,sa.id for update loop
    update public.inventory set allocated=allocated-v_allocation.quantity,version=version+1
      where product_id=v_allocation.product_id;
    update public.stock_allocations set state='released',resolved_at=pg_catalog.clock_timestamp()
      where id=v_allocation.id and state='active';
  end loop;
  update public.payment_attempts set state=case when p_result='expired' then 'expired' else 'failed' end
    where id=p_attempt_id;
  update public.orders set status=case when p_result='expired' then 'expired' else 'payment_failed' end
    where id=p_order_id;
  return pg_catalog.jsonb_build_object('status','processed');
end;
$$;
revoke all on function public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)
  to service_role;
comment on function public.claim_expired_checkout_attempts(integer) is
  'Service-only bounded claim of due order attempts; leases suppress overlapping Cron work and are retried after five minutes.';
comment on function public.apply_checkout_reconciliation(uuid,uuid,text,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text) is
  'Service-only Stripe current-state reconciliation. Order/attempt/allocation/inventory locks serialize with T29/T31; uncertainty retains stock for review.';

-- Supabase Cron invokes the signed Vercel endpoint. Store only the endpoint and
-- this dedicated HMAC secret in Vault; the Stripe secret remains in Vercel.
create function public.invoke_t32_payment_reconciliation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_timestamp text := pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint::text;
  v_body jsonb := pg_catalog.jsonb_build_object('limit',3);
  v_signature text;
  v_request_id bigint;
begin
  select max(s.decrypted_secret) filter (where s.name='t32_reconciliation_url'),
         max(s.decrypted_secret) filter (where s.name='t32_internal_job_secret')
    into v_url,v_secret from vault.decrypted_secrets s
   where s.name in ('t32_reconciliation_url','t32_internal_job_secret');
  if v_url is null and v_secret is null then
    return null; -- Unconfigured Preview/CI: no outbound request and no stock mutation.
  end if;
  if v_url is null or v_secret is null or pg_catalog.octet_length(v_secret)<32
     or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/internal/reconcile-payments$' then
    raise exception 'T32 Cron Vault configuration is missing or invalid' using errcode='55000';
  end if;
  v_signature := pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(v_timestamp||E'\n'||v_body::text,'UTF8'),
    pg_catalog.convert_to(v_secret,'UTF8'),'sha256'),'hex');
  v_request_id := net.http_post(
    url:=v_url,
    body:=v_body,
    headers:=pg_catalog.jsonb_build_object(
      'Content-Type','application/json',
      'X-Internal-Job-Timestamp',v_timestamp,
      'X-Internal-Job-Signature',v_signature),
    timeout_milliseconds:=30000);
  return v_request_id;
end;
$$;
revoke all on function public.invoke_t32_payment_reconciliation() from public,anon,authenticated,service_role;
do $$
begin
  if exists(select 1 from cron.job where jobname='t32-payment-reconciliation') then
    perform cron.unschedule(jobid) from cron.job where jobname='t32-payment-reconciliation';
  end if;
  perform cron.schedule('t32-payment-reconciliation','*/5 * * * *',
    'select public.invoke_t32_payment_reconciliation();');
end;
$$;
