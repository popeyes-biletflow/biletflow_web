-- PB-13: link events to their organizer and support draft/published state.
alter table events add column if not exists organizer_id uuid references profiles(id);
alter table events add column if not exists status text default 'published';

-- Row Level Security: the backend calls Supabase with the organizer's JWT,
-- so these policies are required for create/edit/delete and analytics to work.
alter table events enable row level security;

drop policy if exists "public read published events" on events;
create policy "public read published events" on events
  for select using (status = 'published' or organizer_id = auth.uid());

drop policy if exists "organizer inserts own events" on events;
create policy "organizer inserts own events" on events
  for insert with check (
    organizer_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('organizer','admin'))
  );

drop policy if exists "organizer updates own events" on events;
create policy "organizer updates own events" on events
  for update using (organizer_id = auth.uid());

drop policy if exists "organizer deletes own events" on events;
create policy "organizer deletes own events" on events
  for delete using (organizer_id = auth.uid());

-- Analytics: organizers may read tickets and ticket types of their own events.
drop policy if exists "organizer reads tickets of own events" on tickets;
create policy "organizer reads tickets of own events" on tickets
  for select using (
    user_id = auth.uid()
    or exists (select 1 from events e where e.id = tickets.event_id and e.organizer_id = auth.uid())
  );

drop policy if exists "public read ticket types" on ticket_types;
create policy "public read ticket types" on ticket_types for select using (true);

-- Make your test account an organizer (replace the email):
-- update profiles set role = 'organizer' where email = 'you@nu.edu.kz';
