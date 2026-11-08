-- Migration 002: Paid Sales Activation
-- Safe to re-run on real Supabase schema.

-- -------------------------------------------------------------------------
-- events: organizer_id column (already exists in real schema; ensure safety)
-- -------------------------------------------------------------------------
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS organizer_id UUID REFERENCES profiles(id);

-- -------------------------------------------------------------------------
-- events: paid_sales_active (boolean) and paid_sales_status (NONE/ACTIVE/SUSPENDED, default 'NONE')
-- -------------------------------------------------------------------------
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS paid_sales_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS paid_sales_status TEXT NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'events_paid_sales_status_check'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT events_paid_sales_status_check
            CHECK (paid_sales_status IN ('NONE', 'ACTIVE', 'SUSPENDED'));
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- payments: CREATE TABLE IF NOT EXISTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        REFERENCES profiles(id),
    order_id   UUID        REFERENCES orders(id),
    event_id   UUID        REFERENCES events(id),
    amount     NUMERIC     NOT NULL,
    currency   TEXT        NOT NULL DEFAULT 'KZT',
    status     TEXT        NOT NULL DEFAULT 'completed',
    simulated  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- audit_log: CREATE TABLE IF NOT EXISTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    action       TEXT        NOT NULL,
    performed_by UUID        REFERENCES profiles(id),
    entity_type  TEXT        NOT NULL,
    entity_id    TEXT        NOT NULL,
    metadata     JSONB,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- Function: activate_paid_sales (atomic multi-step write)
-- Keeps paid_sales_active (boolean) in sync: true ONLY when ACTIVE.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION activate_paid_sales(
    p_event_id UUID,
    p_organizer_id UUID,
    p_amount NUMERIC DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_payment_id UUID := gen_random_uuid();
    v_event RECORD;
BEGIN
    -- Check event existence and status
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

    -- 1. Insert payment row marked simulated=true
    INSERT INTO payments (id, user_id, event_id, amount, currency, status, simulated)
    VALUES (v_payment_id, p_organizer_id, p_event_id, p_amount, 'KZT', 'completed', TRUE);

    -- 2. Update event: set paid_sales_status = 'ACTIVE' and paid_sales_active = TRUE
    UPDATE events
    SET paid_sales_status = 'ACTIVE',
        paid_sales_active = TRUE
    WHERE id = p_event_id;

    -- 3. Write audit log entry
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
