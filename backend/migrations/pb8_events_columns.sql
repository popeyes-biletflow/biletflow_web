-- PB-8: columns used by event discovery and event details.
-- Run in the Supabase SQL editor. Safe to re-run.
alter table events add column if not exists description   text;
alter table events add column if not exists category      text;
alter table events add column if not exists starts_at     timestamptz;
alter table events add column if not exists ends_at       timestamptz;
alter table events add column if not exists timezone      text default 'Asia/Almaty';
alter table events add column if not exists venue_name    text;
alter table events add column if not exists venue_address text;
alter table events add column if not exists image_url     text;
alter table events add column if not exists status        text default 'published';
