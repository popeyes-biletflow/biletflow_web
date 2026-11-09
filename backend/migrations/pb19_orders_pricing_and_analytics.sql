-- PB-19 / PB-14 integration. Run in the Supabase SQL editor. Safe to re-run.

-- 1. Price breakdown on orders (checkout now stores what the attendee saw).
alter table orders add column if not exists subtotal_amount integer;
alter table orders add column if not exists discount_amount integer not null default 0;
alter table orders add column if not exists fee_amount      integer not null default 0;
alter table orders add column if not exists promo_code      text;
alter table orders add column if not exists created_at      timestamptz not null default now();

-- 2. Organizer analytics read tickets / orders through the organizer's JWT.
--    These SELECT policies are additive (OR-ed with existing ones); they do not
--    enable RLS by themselves and do not widen access for attendees.
drop policy if exists "pb19 organizer reads tickets of own events" on tickets;
create policy "pb19 organizer reads tickets of own events" on tickets
  for select using (
    user_id = auth.uid()
    or exists (select 1 from events e where e.id = tickets.event_id and e.organizer_id = auth.uid())
  );

drop policy if exists "pb19 organizer reads orders of own events" on orders;
create policy "pb19 organizer reads orders of own events" on orders
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from tickets t join events e on e.id = t.event_id
      where t.order_id = orders.id and e.organizer_id = auth.uid()
    )
  );
