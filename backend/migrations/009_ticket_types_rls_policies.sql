-- 009_ticket_types_rls_policies.sql
-- Allow organizers to insert, update, and delete ticket types for their own events.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ticket_types' AND policyname = 'Organizers can manage ticket types for their events'
  ) THEN
    CREATE POLICY "Organizers can manage ticket types for their events"
    ON public.ticket_types
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events
        WHERE events.id = ticket_types.event_id
        AND events.organizer_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events
        WHERE events.id = ticket_types.event_id
        AND events.organizer_id = auth.uid()
      )
    );
  END IF;
END $$;
