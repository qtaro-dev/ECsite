-- T31 applies verified Stripe Checkout state and deduplicates events in the
-- same transaction as payment-attempt and inventory transitions.

create function public.ignore_stripe_webhook_event(p_event_id text, p_event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or p_event_type is null or pg_catalog.length(p_event_type) not between 1 and 255 then
    return pg_catalog.jsonb_build_object('status','ignored');
  end if;
  insert into public.payment_events(stripe_event_id,event_type,processed_at,outcome)
    values(p_event_id,p_event_type,pg_catalog.clock_timestamp(),'ignored')
    on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows=0 then return pg_catalog.jsonb_build_object('status','duplicate'); end if;
  return pg_catalog.jsonb_build_object('status','ignored');
end;
$$;
revoke all on function public.ignore_stripe_webhook_event(text,text) from public,anon,authenticated;
grant execute on function public.ignore_stripe_webhook_event(text,text) to service_role;
comment on function public.ignore_stripe_webhook_event(text,text) is
  'Service-only dedupe record for a signature-verified Stripe event type not handled by checkout.';

create function public.apply_stripe_checkout_webhook(
  p_event_id text,
  p_event_type text,
  p_result text,
  p_order_id uuid,
  p_attempt_id uuid,
  p_session_id text,
  p_session_mode text,
  p_livemode boolean,
  p_session_status text,
  p_payment_status text,
  p_session_amount_yen integer,
  p_session_currency text,
  p_session_created_at bigint,
  p_session_expires_at bigint,
  p_session_metadata_order_id text,
  p_session_metadata_attempt_id text,
  p_payment_intent_id text,
  p_payment_intent_status text,
  p_payment_intent_amount integer,
  p_payment_intent_amount_received integer,
  p_payment_intent_currency text,
  p_payment_intent_metadata_order_id text,
  p_payment_intent_metadata_attempt_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_rows integer;
  v_candidate_order uuid;
  v_candidate_attempt uuid;
  v_order_status text;
  v_order_currency text;
  v_order_amount integer;
  v_attempt_state text;
  v_attempt_amount integer;
  v_attempt_session_id text;
  v_attempt_intent_id text;
  v_frozen_session_expiry bigint;
  v_allocation_count integer;
  v_active_count integer;
  v_bad_inventory_count integer;
  v_allocation record;
  v_rows integer;
  v_facts_valid boolean;
  v_outcome text := 'processed';
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or p_event_type is null or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed','checkout.session.expired')
     or p_result is null or p_result not in ('succeeded','failed','expired','pending') then
    return pg_catalog.jsonb_build_object('status','ignored');
  end if;

  insert into public.payment_events(stripe_event_id,event_type)
    values(p_event_id,p_event_type) on conflict (stripe_event_id) do nothing;
  get diagnostics v_event_rows = row_count;
  if v_event_rows=0 then return pg_catalog.jsonb_build_object('status','duplicate'); end if;

  -- Metadata correlates the event even if Stripe delivers it before T30 stores
  -- the Session id. The stored Session id is an alternate correlation only;
  -- both metadata copies are still validated below.
  select pa.order_id,pa.id into v_candidate_order,v_candidate_attempt
    from public.payment_attempts pa
    where (p_attempt_id is not null and pa.id=p_attempt_id)
       or (p_session_id is not null and pa.stripe_session_id=p_session_id)
    order by (pa.stripe_session_id=p_session_id) desc
    limit 1;
  if not found then
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  -- Lock contract shared with T29/T30/T32: order, attempt, allocation rows in
  -- product-id order, then inventory rows in the same order.
  select o.status,o.currency,o.grand_total_yen into v_order_status,v_order_currency,v_order_amount
    from public.orders o where o.id=v_candidate_order for update;
  if not found then
    update public.payment_events set attempt_id=v_candidate_attempt,processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;
  select pa.state,pa.amount_yen,pa.stripe_session_id,pa.stripe_payment_intent_id,pa.stripe_session_expires_at
    into v_attempt_state,v_attempt_amount,v_attempt_session_id,v_attempt_intent_id,v_frozen_session_expiry
    from public.payment_attempts pa where pa.id=v_candidate_attempt and pa.order_id=v_candidate_order for update;
  if not found then
    update public.payment_events set attempt_id=v_candidate_attempt,processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  update public.payment_events set attempt_id=v_candidate_attempt where stripe_event_id=p_event_id;
  perform sa.id from public.stock_allocations sa where sa.order_id=v_candidate_order
    order by sa.product_id for update;
  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where sa.state='active')::integer
    into v_allocation_count,v_active_count
    from public.stock_allocations sa where sa.order_id=v_candidate_order;

  v_facts_valid := p_order_id=v_candidate_order
    and p_attempt_id=v_candidate_attempt
    and p_session_id ~ '^cs_test_[A-Za-z0-9_]+$'
    and p_session_mode='payment'
    and p_livemode is false
    and p_session_status in ('open','complete','expired')
    and p_payment_status in ('paid','unpaid','no_payment_required')
    and p_session_amount_yen=v_order_amount
    and v_attempt_amount=v_order_amount
    and v_order_currency='JPY'
    and pg_catalog.lower(pg_catalog.btrim(v_order_currency))=pg_catalog.lower(p_session_currency)
    and p_session_created_at is not null
    and p_session_expires_at is not null
    and p_session_expires_at>p_session_created_at
    and v_frozen_session_expiry=p_session_expires_at
    and pg_catalog.to_timestamp(p_session_expires_at)<=
      (select pa.expires_at from public.payment_attempts pa where pa.id=v_candidate_attempt)
    and p_session_metadata_order_id=v_candidate_order::text
    and p_session_metadata_attempt_id=v_candidate_attempt::text
    and (v_attempt_session_id is null or v_attempt_session_id=p_session_id)
    and (p_payment_intent_id is null or p_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$')
    and (v_attempt_intent_id is null or v_attempt_intent_id=p_payment_intent_id)
    and (p_payment_intent_id is null or (
      p_payment_intent_amount=v_order_amount
      and pg_catalog.lower(p_payment_intent_currency)='jpy'
      and p_payment_intent_metadata_order_id=v_candidate_order::text
      and p_payment_intent_metadata_attempt_id=v_candidate_attempt::text
    ));

  if v_facts_valid is not true then
    -- Retain all inventory for operator review. Never infer a payment outcome
    -- from a Session that disagrees with our amount, currency, ids or mode.
    if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
      update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
      update public.orders set status='review_required' where id=v_candidate_order;
    end if;
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','needs_review');
  end if;

  if v_attempt_session_id is null then
    update public.payment_attempts set stripe_session_id=p_session_id
      where id=v_candidate_attempt and stripe_session_id is null;
  end if;
  if p_payment_intent_id is not null and v_attempt_intent_id is null then
    if exists(select 1 from public.payment_attempts pa
      where pa.stripe_payment_intent_id=p_payment_intent_id and pa.id<>v_candidate_attempt) then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    update public.payment_attempts set stripe_payment_intent_id=p_payment_intent_id
      where id=v_candidate_attempt and stripe_payment_intent_id is null;
  end if;

  if v_order_status='paid' and v_attempt_state='succeeded' then
    v_outcome := case when p_result='succeeded' and p_payment_intent_status='succeeded'
      then 'processed' else 'ignored' end;
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome=v_outcome
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status',v_outcome);
  end if;

  if p_result='pending' then
    if v_order_status='payment_pending' and v_attempt_state='created' then
      update public.payment_attempts set state='processing' where id=v_candidate_attempt;
    end if;
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='ignored'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','ignored');
  end if;

  if p_result='succeeded' then
    if p_session_status is distinct from 'complete' or p_payment_status is distinct from 'paid'
       or p_payment_intent_id is null or p_payment_intent_status is distinct from 'succeeded'
       or p_payment_intent_amount_received is distinct from v_order_amount then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;

    if v_order_status not in ('payment_pending','review_required')
       or v_attempt_state not in ('created','processing','review_required') then
      -- A late success after failure/expiry is held for the explicit state
      -- transition rule; it is never allowed to consume released stock here.
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    if v_allocation_count=0 or v_active_count<>v_allocation_count then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;

    select pg_catalog.count(*)::integer into v_bad_inventory_count
      from public.stock_allocations sa left join public.inventory i on i.product_id=sa.product_id
      where sa.order_id=v_candidate_order and sa.state='active'
        and (sa.product_id is null or i.product_id is null or i.on_hand<sa.quantity or i.allocated<sa.quantity);
    if v_bad_inventory_count<>0 then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;

    for v_allocation in select sa.id,sa.product_id,sa.quantity from public.stock_allocations sa
      where sa.order_id=v_candidate_order and sa.state='active' order by sa.product_id for update loop
      update public.inventory i set on_hand=i.on_hand-v_allocation.quantity,
        allocated=i.allocated-v_allocation.quantity,version=i.version+1
        where i.product_id=v_allocation.product_id;
      update public.stock_allocations sa set state='consumed',resolved_at=pg_catalog.clock_timestamp()
        where sa.id=v_allocation.id and sa.state='active';
    end loop;
    update public.payment_attempts set state='succeeded',stripe_payment_intent_id=p_payment_intent_id
      where id=v_candidate_attempt;
    update public.orders set status='paid',paid_at=pg_catalog.clock_timestamp()
      where id=v_candidate_order;
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='processed'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','processed');
  end if;

  if p_result in ('failed','expired') then
    if (p_result='failed' and (p_event_type is distinct from 'checkout.session.async_payment_failed'
          or p_session_status is distinct from 'complete' or p_payment_status is distinct from 'unpaid'
          or p_payment_intent_status is null
          or p_payment_intent_status not in ('requires_payment_method','canceled'))
       or (p_result='expired' and (p_session_status is distinct from 'expired'
          or (p_payment_intent_status is not null and p_payment_intent_status in ('succeeded','processing')))) then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    if v_order_status='paid' or v_attempt_state='succeeded' then
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='ignored'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','ignored');
    end if;
    if v_order_status in ('payment_failed','expired') and v_active_count=0
       and v_attempt_state in ('failed','expired') then
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='processed'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','processed');
    end if;
    if v_order_status not in ('payment_pending','review_required')
       or v_attempt_state not in ('created','processing','review_required') then
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    if v_allocation_count=0 or v_active_count<>v_allocation_count then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;
    select pg_catalog.count(*)::integer into v_bad_inventory_count
      from public.stock_allocations sa left join public.inventory i on i.product_id=sa.product_id
      where sa.order_id=v_candidate_order and sa.state='active'
        and (sa.product_id is null or i.product_id is null or i.allocated<sa.quantity);
    if v_bad_inventory_count<>0 then
      if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then
        update public.payment_attempts set state='review_required' where id=v_candidate_attempt;
        update public.orders set status='review_required' where id=v_candidate_order;
      end if;
      update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='needs_review'
        where stripe_event_id=p_event_id;
      return pg_catalog.jsonb_build_object('status','needs_review');
    end if;

    for v_allocation in select sa.id,sa.product_id,sa.quantity from public.stock_allocations sa
      where sa.order_id=v_candidate_order and sa.state='active' order by sa.product_id for update loop
      update public.inventory i set allocated=i.allocated-v_allocation.quantity,version=i.version+1
        where i.product_id=v_allocation.product_id;
      update public.stock_allocations sa set state='released',resolved_at=pg_catalog.clock_timestamp()
        where sa.id=v_allocation.id and sa.state='active';
    end loop;
    update public.payment_attempts set state=case when p_result='expired' then 'expired' else 'failed' end
      where id=v_candidate_attempt;
    update public.orders set status=case when p_result='expired' then 'expired' else 'payment_failed' end
      where id=v_candidate_order;
    update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='processed'
      where stripe_event_id=p_event_id;
    return pg_catalog.jsonb_build_object('status','processed');
  end if;

  update public.payment_events set processed_at=pg_catalog.clock_timestamp(),outcome='ignored'
    where stripe_event_id=p_event_id;
  return pg_catalog.jsonb_build_object('status','ignored');
end;
$$;
revoke all on function public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)
  to service_role;
comment on function public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text) is
  'Service-only atomic payment event dedupe, current Stripe Checkout state validation, and inventory consume/release. Database/API uncertainty rolls back the event so Stripe can retry.';
