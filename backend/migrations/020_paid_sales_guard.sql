-- Migration 020: paid_sales_status / paid_sales_active change only through activation or admin moderation.
-- Requires 019 (is_platform_admin_user). Safe to re-run.

CREATE OR REPLACE FUNCTION activate_paid_sales(
    p_event_id UUID,
    p_organizer_id UUID,
    p_amount NUMERIC DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id UUID := gen_random_uuid();
    v_event RECORD;
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT is_platform_admin_user(auth.uid())
       AND (
            p_organizer_id <> auth.uid()
            OR NOT EXISTS (SELECT 1 FROM events WHERE id = p_event_id AND organizer_id = auth.uid())
       ) THEN
        RAISE EXCEPTION 'Only the event organizer can activate paid sales' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_event FROM events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Event not found';
    END IF;

    IF v_event.paid_sales_status = 'SUSPENDED' THEN
        RAISE EXCEPTION 'Event paid sales are suspended';
    END IF;

    IF v_event.paid_sales_status = 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'status', 'already_active',
            'event_id', p_event_id,
            'paid_sales_status', 'ACTIVE',
            'paid_sales_active', TRUE
        );
    END IF;

    INSERT INTO payments (id, user_id, event_id, amount, currency, status, simulated)
    VALUES (v_payment_id, p_organizer_id, p_event_id, p_amount, 'KZT', 'completed', TRUE);

    UPDATE events
    SET paid_sales_status = 'ACTIVE',
        paid_sales_active = TRUE
    WHERE id = p_event_id;

    INSERT INTO audit_log (action, performed_by, entity_type, entity_id, metadata)
    VALUES (
        'PAID_SALES_ACTIVATED',
        p_organizer_id,
        'event',
        p_event_id::TEXT,
        jsonb_build_object(
            'payment_id', v_payment_id,
            'amount_kzt', p_amount,
            'simulated', TRUE
        )
    );

    RETURN jsonb_build_object(
        'status', 'activated',
        'event_id', p_event_id,
        'payment_id', v_payment_id,
        'paid_sales_status', 'ACTIVE',
        'paid_sales_active', TRUE
    );
END;
$$;

REVOKE ALL ON FUNCTION activate_paid_sales(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION activate_paid_sales(UUID, UUID, NUMERIC) TO authenticated, service_role;

-- invoker on purpose: current_user is the owner inside SECURITY DEFINER functions, the session role otherwise
CREATE OR REPLACE FUNCTION guard_paid_sales_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.paid_sales_status IS DISTINCT FROM OLD.paid_sales_status
        OR NEW.paid_sales_active IS DISTINCT FROM OLD.paid_sales_active)
       AND current_user IN ('authenticated', 'anon')
       AND NOT is_platform_admin_user(auth.uid()) THEN
        RAISE EXCEPTION 'paid_sales_status and paid_sales_active change only through paid-sales activation'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_paid_sales_columns ON events;
CREATE TRIGGER guard_paid_sales_columns
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION guard_paid_sales_columns();
