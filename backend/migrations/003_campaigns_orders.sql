create table if not exists campaigns (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  organizer_id     uuid not null references profiles(id),
  name             text not null,
  discount_percent int  not null check (discount_percent between 1 and 100),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,
  qr_slug          text not null unique,
  created_at       timestamptz default now(),
  check (ends_at > starts_at)
);

create table if not exists promo_codes (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  code        text not null,
  max_uses    int  not null check (max_uses > 0),
  unique (event_id, code)
);

create table if not exists campaign_scans (
  id          bigserial primary key,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  scanned_at  timestamptz default now()
);

create table if not exists ticket_holds (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id),
  event_id       uuid not null references events(id),
  ticket_type_id uuid not null references ticket_types(id),
  quantity       int  not null check (quantity > 0),
  promo_code_id  uuid references promo_codes(id),
  campaign_id    uuid references campaigns(id),
  subtotal_kzt   int  not null,
  discount_kzt   int  not null,
  fee_kzt        int  not null,
  total_kzt      int  not null,
  status         text not null default 'active'
                 check (status in ('active','converted','released','expired')),
  expires_at     timestamptz not null,
  created_at     timestamptz default now()
);

create index if not exists ticket_holds_type_active_idx
  on ticket_holds (ticket_type_id) where status = 'active';

alter table orders add column if not exists event_id       uuid references events(id);
alter table orders add column if not exists ticket_type_id uuid references ticket_types(id);
alter table orders add column if not exists quantity       int;
alter table orders add column if not exists hold_id        uuid references ticket_holds(id);
alter table orders add column if not exists promo_code_id  uuid references promo_codes(id);
alter table orders add column if not exists campaign_id    uuid references campaigns(id);
alter table orders add column if not exists subtotal_kzt   int;
alter table orders add column if not exists discount_kzt   int;
alter table orders add column if not exists fee_kzt        int;
alter table orders add column if not exists currency       text default 'KZT';
alter table orders add column if not exists fx_rate        numeric;
alter table orders add column if not exists charged_minor  bigint;
alter table orders add column if not exists gateway_txn_id text;
alter table orders add column if not exists created_at     timestamptz default now();

alter table campaigns      enable row level security;
alter table promo_codes    enable row level security;
alter table campaign_scans enable row level security;
alter table ticket_holds   enable row level security;

drop policy if exists "own holds" on ticket_holds;
create policy "own holds" on ticket_holds
  for select using (user_id = auth.uid());