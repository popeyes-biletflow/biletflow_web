-- Migration 008: Staff assignments, notifications, platform settings, and atomic check-in/undo

CREATE TABLE IF NOT EXISTS event_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT event_staff_event_user_unique UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO platform_settings (key, value)
VALUES ('activation_fee_kzt', '5000'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION checkin_ticket_atomic(
    p_ticket_id UUID,
    p_event_id UUID,
    p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_ticket RECORD;
    v_updated RECORD;
BEGIN
    SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
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
AS $$
DECLARE
    v_ticket RECORD;
    v_updated RECORD;
BEGIN
    SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
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
