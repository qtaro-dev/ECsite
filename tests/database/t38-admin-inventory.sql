\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000000381','authenticated','authenticated','t38-admin@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000382','authenticated','authenticated','t38-member@example.test',now(),now()),
 ('00000000-0000-4000-8000-000000000383','authenticated','authenticated','t38-revoked@example.test',now(),now());
insert into public.admin_memberships(user_id,granted_by) values
 ('00000000-0000-4000-8000-000000000381',null),
 ('00000000-0000-4000-8000-000000000383',null);
update public.admin_memberships set revoked_at=now() where user_id='00000000-0000-4000-8000-000000000383';

do $$ begin
  if has_function_privilege('anon','public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.admin_adjust_inventory(uuid,integer,text,bigint,uuid,text)','EXECUTE') then
    raise exception 'inventory adjustment RPC grants are incorrect';
  end if;
  if has_table_privilege('anon','public.inventory','UPDATE') or has_table_privilege('authenticated','public.inventory','UPDATE')
     or has_table_privilege('authenticated','public.inventory_adjustments','INSERT') then
    raise exception 'browser role can directly mutate inventory or adjustment history';
  end if;
end $$;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.admin_save_product('00000000-0000-4000-8000-000000000384',null,
  '{"category_slug":"cpu","slug":"t38-stock-test","sku":"T38-STOCK","name":"T38 inventory fixture","brand":"T38","description":"fixture","beginner_note":"fixture","price_tax_included_yen":1000,"status":"draft","weight_g":500,"pack_length_mm":100,"pack_width_mm":100,"pack_height_mm":100}'::jsonb,
  '{"socket_code":"AM5"}'::jsonb,'{}'::text[],'[]'::jsonb,'00000000-0000-4000-8000-000000000381','t38-create-fixture');
insert into public.inventory(product_id,on_hand,allocated,version)
  values('00000000-0000-4000-8000-000000000384',3,2,0);

do $$ declare result jsonb; rejected boolean; begin
  rejected:=false;
  begin
    perform public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',1,'member attempt',0,
      '00000000-0000-4000-8000-000000000382','t38-member-refused');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'non-admin actor was allowed to adjust inventory'; end if;

  rejected:=false;
  begin
    perform public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',1,'revoked attempt',0,
      '00000000-0000-4000-8000-000000000383','t38-revoked-refused');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'revoked admin actor was allowed to adjust inventory'; end if;

  result:=public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',-2,'below allocated',0,
    '00000000-0000-4000-8000-000000000381','t38-floor');
  if result->>'status'<>'below_allocated' or (result->>'onHand')::integer<>3 then
    raise exception 'inventory below allocation floor was not rejected with current state';
  end if;
  result:=public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',-4,'below zero',0,
    '00000000-0000-4000-8000-000000000381','t38-zero');
  if result->>'status'<>'below_zero' then raise exception 'negative inventory was not rejected'; end if;
  update public.inventory set on_hand=2147483647,allocated=0,version=0 where product_id='00000000-0000-4000-8000-000000000384';
  result:=public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',1,'overflow attempt',0,
    '00000000-0000-4000-8000-000000000381','t38-maximum');
  if result->>'status'<>'above_maximum' or (result->>'onHand')::bigint<>2147483647 or (result->>'version')::integer<>0 then
    raise exception 'inventory integer maximum was not reported as a controlled rejection';
  end if;
  update public.inventory set on_hand=3,allocated=2,version=0 where product_id='00000000-0000-4000-8000-000000000384';
  result:=public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',1,'receive stock',0,
    '00000000-0000-4000-8000-000000000381','t38-success');
  if result->>'status'<>'updated' or (result->>'onHand')::integer<>4 or (result->>'allocated')::integer<>2
     or (result->>'available')::integer<>2 or (result->>'version')::integer<>1
     or result->>'adjustmentId' is null or result->>'auditId' is null then
    raise exception 'valid inventory adjustment did not return updated stock and audit references';
  end if;
  result:=public.admin_adjust_inventory('00000000-0000-4000-8000-000000000384',1,'stale version',0,
    '00000000-0000-4000-8000-000000000381','t38-stale');
  if result->>'status'<>'conflict' or (result->>'version')::integer<>1 or (select on_hand from public.inventory where product_id='00000000-0000-4000-8000-000000000384')<>4 then
    raise exception 'stale inventory version did not return the latest value without mutation';
  end if;
  if (select count(*) from public.inventory_adjustments where product_id='00000000-0000-4000-8000-000000000384')<>1
     or (select count(*) from public.audit_logs where request_id='t38-success')<>1 then
    raise exception 'successful adjustment history and audit record are not atomic';
  end if;
end $$;

rollback;
