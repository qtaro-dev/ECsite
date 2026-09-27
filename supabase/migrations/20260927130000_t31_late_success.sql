-- T31 approved late-success policy: terminal payments may become paid only
-- through the service-only, fully verified webhook RPC and only while every
-- stock allocation remains active and its inventory quantity is still present.

create or replace function public.guard_order_status_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if old.status = 'payment_pending' and new.status in ('paid','payment_failed','expired','review_required') then return new; end if;
  if old.status = 'review_required' and new.status in ('paid','payment_failed','expired') then return new; end if;
  if old.status in ('payment_failed','expired') and new.status in ('paid','review_required') then return new; end if;
  raise exception 'invalid order status transition: % -> %', old.status, new.status using errcode = '23514';
end;
$$;

create or replace function public.guard_payment_attempt_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if old.state = 'created' and new.state in ('processing','failed','expired','review_required') then return new; end if;
  if old.state = 'processing' and new.state in ('succeeded','failed','expired','review_required') then return new; end if;
  if old.state = 'review_required' and new.state in ('succeeded','failed','expired') then return new; end if;
  if old.state in ('failed','expired') and new.state in ('succeeded','review_required') then return new; end if;
  raise exception 'invalid payment attempt transition: % -> %', old.state, new.state using errcode = '23514';
end;
$$;

-- Change only the successful-event branch. Distinct start/end markers keep the
-- similarly-worded failure branch intact, and exact-count assertions fail closed.
do $$
declare
  v_definition text;
  v_success_start integer;
  v_failed_start integer;
  v_success_block text;
  v_old_status_check text := $old$if v_order_status not in ('payment_pending','review_required')
       or v_attempt_state not in ('created','processing','review_required') then$old$;
  v_new_status_check text := $new$if v_order_status not in ('payment_pending','review_required','payment_failed','expired')
       or v_attempt_state not in ('created','processing','review_required','failed','expired')
       or (v_order_status in ('payment_failed','expired') and v_attempt_state not in ('failed','expired','review_required'))
       or (v_attempt_state in ('failed','expired') and v_order_status not in ('payment_failed','expired','review_required')) then$new$;
  v_old_review_check text := $old$if v_order_status='payment_pending' and v_attempt_state in ('created','processing') then$old$;
  v_new_review_check text := $new$if v_order_status in ('payment_pending','payment_failed','expired')
         and v_attempt_state in ('created','processing','failed','expired') then$new$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text)'::regprocedure
  ) into v_definition;
  v_success_start := pg_catalog.strpos(v_definition, 'if p_result=''succeeded'' then');
  v_failed_start := pg_catalog.strpos(v_definition, 'if p_result in (''failed'',''expired'') then');
  if v_success_start=0 or v_failed_start<=v_success_start then
    raise exception 'T31 webhook succeeded/failure branch markers changed; review migration';
  end if;
  v_success_block := pg_catalog.substring(v_definition from v_success_start for v_failed_start-v_success_start);
  if pg_catalog.length(v_success_block)-pg_catalog.length(pg_catalog.replace(v_success_block,v_old_status_check,''))
       <> pg_catalog.length(v_old_status_check) then
    raise exception 'T31 success status check did not match exactly once';
  end if;
  if pg_catalog.length(v_success_block)-pg_catalog.length(pg_catalog.replace(v_success_block,v_old_review_check,''))
       <> 3*pg_catalog.length(v_old_review_check) then
    raise exception 'T31 success review checks did not match exactly three times';
  end if;
  v_success_block := pg_catalog.replace(v_success_block,v_old_status_check,v_new_status_check);
  v_success_block := pg_catalog.replace(v_success_block,v_old_review_check,v_new_review_check);
  v_definition := pg_catalog.overlay(v_definition placing v_success_block from v_success_start for v_failed_start-v_success_start);
  execute v_definition;
end;
$$;

comment on function public.guard_order_status_transition() is
  'State guard; terminal-to-paid/review transitions are performed only by trusted server-side service RPCs after verified Stripe state and allocation checks.';
comment on function public.guard_payment_attempt_transition() is
  'State guard; terminal-to-succeeded/review transitions are performed only by trusted server-side service RPCs after verified Stripe state and allocation checks.';
comment on function public.apply_stripe_checkout_webhook(text,text,text,uuid,uuid,text,text,boolean,text,text,integer,text,bigint,bigint,text,text,text,text,integer,integer,text,text,text) is
  'Service-only atomic webhook handler; a late success consumes stock only when every allocation remains active and inventory is sufficient, otherwise records review_required without changing stock.';
