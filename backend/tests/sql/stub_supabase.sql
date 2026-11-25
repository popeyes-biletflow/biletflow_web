-- Supabase stand-ins and minimal tables for run_migration_checks.sh. Not the real schema.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create table profiles(id uuid primary key, role text, full_name text);
create table events(
  id uuid primary key, organizer_id uuid,
  paid_sales_status text not null default 'NONE',
  paid_sales_active boolean not null default false);
create table tickets(
  id uuid primary key, event_id uuid, user_id uuid, status text,
  checked_in_at timestamptz, checked_in_by uuid, updated_at timestamptz);
create table audit_log(
  id uuid default gen_random_uuid(), action text, performed_by uuid,
  entity_type text, entity_id text, metadata jsonb);
create table payments(
  id uuid, user_id uuid, event_id uuid, amount numeric,
  currency text, status text, simulated boolean);
create table event_staff(
  id uuid primary key default gen_random_uuid(), event_id uuid, user_id uuid);

grant usage on schema public, auth to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

alter table tickets enable row level security;
create policy attendee_reads_own on tickets for select to authenticated using (user_id = auth.uid());

create function expect(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
grant execute on function expect(text, boolean) to authenticated, anon, service_role;
