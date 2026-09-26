-- T21: keep browser-side address CRUD within the existing owner RLS rules,
-- while serializing default changes so concurrent requests cannot race.
create or replace function public.prepare_member_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipient_name is null or char_length(btrim(new.recipient_name)) not between 1 and 80
     or new.postal_code !~ '^[0-9]{7}$'
     or new.prefecture_code not between 1 and 47
     or new.city is null or char_length(btrim(new.city)) not between 1 and 100
     or new.street is null or char_length(btrim(new.street)) not between 1 and 150
     or char_length(btrim(coalesce(new.building, ''))) > 100 then
    raise exception 'invalid member address fields' using errcode = '23514';
  end if;
  new.recipient_name := btrim(new.recipient_name);
  new.city := btrim(new.city);
  new.street := btrim(new.street);
  new.building := nullif(btrim(new.building), '');

  if new.is_default then
    -- Lock by owner before clearing previous default row(s). A transaction
    -- advisory lock handles the case where the user has no default row yet.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
    update public.addresses
      set is_default = false
      where user_id = new.user_id and is_default
        and (tg_op = 'INSERT' or id <> new.id);
  end if;
  return new;
end;
$$;

create trigger addresses_prepare_member
before insert or update of recipient_name, postal_code, prefecture_code, city, street, building, is_default, user_id
on public.addresses
for each row execute function public.prepare_member_address();

revoke execute on function public.prepare_member_address() from public, anon, authenticated;
