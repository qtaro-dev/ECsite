\set ON_ERROR_STOP on
-- Isolated T28 browser fixture. The account password is generated at runtime
-- by tests/e2e/t28-create-member.mjs and is never committed.
update public.shipping_settings set is_active=false where is_active;
insert into public.shipping_settings(version,origin_prefecture_code,base_fee_yen,free_threshold_yen,
  heavy_threshold_g,heavy_rule_json,yamato_source_url,source_checked_at,is_active,created_by)
values ('t28-e2e-rates-v1',13,940,10000,20000,'{"rates":[]}'::jsonb,
  'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html',now(),true,
  (select id from auth.users where email='t28-member@example.test'));
-- T15 already publishes this synthetic CPU; give this isolated member cart stock.
insert into public.inventory(product_id,on_hand,allocated)
select id,5,0 from public.products where slug='t11-cpu-am5'
on conflict(product_id) do update set on_hand=excluded.on_hand,allocated=0;
