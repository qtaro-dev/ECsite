-- Optional storage specifications. Existing rows keep NULL, distinct from zero.
alter table public.motherboard_specs
  add column sata_port_count integer check (sata_port_count >= 0),
  add column m2_slot_count integer check (m2_slot_count >= 0),
  add column m2_protocols text[] check (
    array_position(m2_protocols, null) is null
    and m2_protocols <@ array['SATA','PCIe']::text[] and cardinality(m2_protocols) <= 2
    and (cardinality(m2_protocols) <> 2 or m2_protocols[1] <> m2_protocols[2])
  );

alter table public.hdd_specs
  add column power_w numeric check (power_w > 0 and power_w <= 1000);
