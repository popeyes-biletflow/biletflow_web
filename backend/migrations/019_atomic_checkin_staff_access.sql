-- Migration 019: check-in/undo functions that assigned staff can run, per-assignment undo, staff read access.
-- Safe to re-run.

ALTER TABLE event_staff ADD COLUMN IF NOT EXISTS can_undo BOOLEAN NOT NULL DEFAULT TRUE;

-- Authorization helpers (SECURITY DEFINER so they are not filtered by RLS)
CREATE OR REPLACE FUNCTION is_platform_admin_user(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = p_uid AND lower(role::text) IN ('platform_admin', 'admin')
    );
$$;

CREATE OR REPLACE FUNCTION can_manage_checkin(p_event_id UUID, p_uid UUID, p_for_undo BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT is_platform_admin_user(p_uid)
        OR EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.organizer_id = p_uid)
        OR EXISTS (
            SELECT 1 FROM event_staff s
            WHERE s.event_id = p_event_id
              AND s.user_id = p_uid
              AND (NOT p_for_undo OR s.can_undo)
        );
$$;

CREATE OR REPLACE FUNCTION is_event_staff(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM event_staff s WHERE s.event_id = p_event_id AND s.user_id = auth.uid()
    );
$$;

-- Atomic admission
CREATE OR REPLACE FUNCTION checkin_ticket_atomic(
    p_ticket_id UUID,
    p_event_id UUID,
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    v_ticket RECORD;
    v_updated RECORD;
BEGIN
    -- user token: must be the staff member recorded and allowed on the event; no user: service role only
    IF v_uid IS NULL THEN
        IF v_role <> 'service_role' THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'FORBIDDEN', 'message', 'Authentication is required.');
        END IF;
    ELSIF v_uid <> p_staff_id OR NOT can_manage_checkin(p_event_id, v_uid, FALSE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'FORBIDDEN', 'message', 'You are not assigned to manage check-ins for this event.');
    END IF;

    -- lock the row so simultaneous scans are decided one at a time
    SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'NOT_FOUND', 'message', 'Ticket not found.');
    END IF;

    IF v_ticket.event_id != p_event_id THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'WRONG_EVENT', 'message', 'This ticket belongs to a different event.');
    END IF;

    IF v_ticket.status = 'checked_in' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ALREADY_USED', 'message', 'Ticket has already been used.');
    END IF;

    IF v_ticket.status IN ('cancelled', 'refunded') THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'INVALID_STATUS', 'message', 'Ticket is cancelled or refunded.');
    END IF;

    IF v_ticket.status <> 'valid' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'INVALID_STATUS', 'message', 'Ticket is not valid for entry.');
    END IF;

    UPDATE tickets
    SET status = 'checked_in',
        checked_in_at = now(),
        checked_in_by = p_staff_id,
        updated_at = now()
    WHERE id = p_ticket_id AND status = 'valid'
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'ALREADY_USED', 'message', 'Ticket has already been used.');
    END IF;

    INSERT INTO audit_log (action, performed_by, entity_type, entity_id, metadata)
    VALUES (
        'TICKET_CHECKIN',
        p_staff_id,
        'ticket',
        p_ticket_id::TEXT,
        jsonb_build_object('event_id', p_event_id, 'checked_in_at', now())
    );

    RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id, 'message', 'Check-in successful');
END;
$$;

CREATE OR REPLACE FUNCTION undo_checkin_atomic(
    p_ticket_id UUID,
    p_event_id UUID,
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
    v_ticket RECORD;
    v_updated RECORD;
BEGIN
    IF v_uid IS NULL THEN
        IF v_role <> 'service_role' THEN
            RETURN jsonb_build_object('success', FALSE, 'error_code', 'FORBIDDEN', 'message', 'Authentication is required.');
        END IF;
    ELSIF v_uid <> p_staff_id OR NOT can_manage_checkin(p_event_id, v_uid, TRUE) THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'FORBIDDEN', 'message', 'You are not allowed to undo check-ins for this event.');
    END IF;

    SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'NOT_FOUND', 'message', 'Ticket not found.');
    END IF;

    IF v_ticket.event_id != p_event_id THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'WRONG_EVENT', 'message', 'Ticket does not belong to this event.');
    END IF;

    IF v_ticket.status != 'checked_in' THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'NOT_CHECKED_IN', 'message', 'Ticket is not checked in.');
    END IF;

    UPDATE tickets
    SET status = 'valid',
        checked_in_at = NULL,
        checked_in_by = NULL,
        updated_at = now()
    WHERE id = p_ticket_id AND status = 'checked_in'
    RETURNING * INTO v_updated;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error_code', 'NOT_CHECKED_IN', 'message', 'Ticket is not checked in.');
    END IF;

    INSERT INTO audit_log (action, performed_by, entity_type, entity_id, metadata)
    VALUES (
        'TICKET_CHECKIN_REVERSED',
        p_staff_id,
        'ticket',
        p_ticket_id::TEXT,
        jsonb_build_object('event_id', p_event_id, 'reversed_at', now(), 'reversed_by', p_staff_id)
    );

    RETURN jsonb_build_object('success', TRUE, 'ticket_id', p_ticket_id, 'message', 'Check-in undone');
END;
$$;

-- Not callable anonymously.
REVOKE ALL ON FUNCTION checkin_ticket_atomic(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION undo_checkin_atomic(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION can_manage_checkin(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_platform_admin_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION checkin_ticket_atomic(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION undo_checkin_atomic(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_checkin(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_platform_admin_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_event_staff(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- assigned staff can read the tickets of their events (counters, attendee list)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "assigned staff read event tickets" ON tickets;
CREATE POLICY "assigned staff read event tickets" ON tickets
    FOR SELECT TO authenticated
    USING (is_event_staff(event_id));

-- staff can read their own assignments
DROP POLICY IF EXISTS "staff read own assignments" ON event_staff;
CREATE POLICY "staff read own assignments" ON event_staff
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
