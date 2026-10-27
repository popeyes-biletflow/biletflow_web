-- PB-13: link events to their organizer and support draft/published state.
alter table events add column if not exists organizer_id uuid references profiles(id);
alter table events add column if not exists status text default 'published';
