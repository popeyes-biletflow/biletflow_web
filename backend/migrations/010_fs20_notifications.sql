-- FS-20: notifications without duplicates + email outbox. Run after 008. Safe to re-run.

-- 1. In-app notifications: one row per dedupe key (a retried request does not notify twice)
alter table notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_uidx
  on notifications (dedupe_key) where dedupe_key is not null;

-- 2. Email outbox: every transactional email is stored first, then sent.
--    A failed SMTP attempt stays 'failed' and is retried later; the order/ticket
--    that triggered it is never rolled back.
create table if not exists email_outbox (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  user_id     uuid references profiles(id) on delete set null,
  to_email    text not null,
  template    text not null,
  subject     text not null,
  body_text   text not null,
  body_html   text not null,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists email_outbox_retry_idx on email_outbox (status) where status <> 'sent';

-- Emails contain personal data: no access through the public (anon) API.
-- The backend writes here with SUPABASE_SERVICE_KEY (service role bypasses RLS).
alter table email_outbox enable row level security;
