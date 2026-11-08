-- Migration 001: Support Cases
-- Creates support_cases and support_messages tables with all necessary constraints.

-- -------------------------------------------------------------------------
-- support_cases
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_cases (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID        NOT NULL REFERENCES profiles(id),
    category     TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'OPEN',
    subject      TEXT        NOT NULL,
    event_id     UUID        REFERENCES events(id),
    order_id     UUID        REFERENCES orders(id),
    ticket_id    UUID        REFERENCES tickets(id),
    assigned_to  UUID        REFERENCES profiles(id),
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT support_cases_category_check CHECK (
        category IN (
            'ticket_delivery',
            'payment',
            'refund',
            'seating',
            'event_information',
            'check_in',
            'account',
            'technical'
        )
    ),
    CONSTRAINT support_cases_status_check CHECK (
        status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED')
    )
);

-- -------------------------------------------------------------------------
-- support_messages
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_messages (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id    UUID        NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
    sender_id  UUID        NOT NULL REFERENCES profiles(id),
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -------------------------------------------------------------------------
-- Trigger: auto-update support_cases.updated_at on row update
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_support_cases_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_cases_updated_at ON support_cases;

CREATE TRIGGER trg_support_cases_updated_at
    BEFORE UPDATE ON support_cases
    FOR EACH ROW
    EXECUTE FUNCTION set_support_cases_updated_at();
