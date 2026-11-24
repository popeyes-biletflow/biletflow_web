-- Allow drafts to be created without event_date (which is a legacy column superseded by starts_at)
ALTER TABLE public.events ALTER COLUMN event_date DROP NOT NULL;
