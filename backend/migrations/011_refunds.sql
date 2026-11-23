alter table events add column if not exists refund_policy text not null default 'full_until_start'
  check (refund_policy in ('none', 'full_until_start', 'full_24h_before'));

create table if not exists refunds (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id),
  event_id         uuid not null references events(id),
  requested_by     uuid not null references profiles(id),
  reason           text,
  amount_kzt       int  not null check (amount_kzt >= 0),
  fee_refunded_kzt int  not null default 0,
  status           text not null default 'completed' check (status in ('completed', 'rejected')),
  ticket_ids       uuid[] not null,
  created_at       timestamptz default now()
);

create unique index if not exists refunds_one_completed_per_order
  on refunds (order_id) where status = 'completed';

alter table refunds enable row level security;
drop policy if exists "own refunds" on refunds;
create policy "own refunds" on refunds for select using (requested_by = auth.uid());