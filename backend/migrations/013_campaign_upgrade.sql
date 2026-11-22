alter table campaigns add column if not exists discount_type  text not null default 'percent'
  check (discount_type in ('percent', 'fixed_kzt'));
alter table campaigns add column if not exists discount_value int;
alter table campaigns add column if not exists ticket_type_id uuid references ticket_types(id);
alter table campaigns add column if not exists is_disabled    boolean not null default false;

update campaigns set discount_value = discount_percent where discount_value is null;

alter table campaigns alter column discount_percent drop not null;