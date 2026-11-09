-- Additive event / ticket_type columns. Safe to re-run.
alter table events add column if not exists status text default 'draft' check (status in ('draft', 'published', 'cancelled'));
alter table events add column if not exists visibility text default 'public' check (visibility in ('public', 'unlisted', 'private'));
alter table events add column if not exists registration_opens_at timestamptz;
alter table events add column if not exists registration_closes_at timestamptz;
alter table events add column if not exists capacity int;

alter table ticket_types add column if not exists name text;
alter table ticket_types add column if not exists description text;
alter table ticket_types add column if not exists sale_starts_at timestamptz;
alter table ticket_types add column if not exists sale_ends_at timestamptz;
alter table ticket_types add column if not exists max_per_order int;
alter table ticket_types add column if not exists is_hidden boolean default false;
