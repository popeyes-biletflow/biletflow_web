import os

os.environ.setdefault("QR_SECRET", "test-secret")

from datetime import datetime, timedelta, timezone

from tests.test_pb18 import ORGANIZER, OTHER, event, run
from tests.fakedb import FakeDB

OTHER_ORG = ORGANIZER.model_copy(update={"id": "org-2"})


def iso(h):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()


def db():
    return FakeDB(
        events=[event()],
        ticket_types=[{"id": "tt-1", "event_id": "ev-1", "name": "GA", "price": 0, "quantity": 10, "is_hidden": False}],
        tickets=[
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "valid"},
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "checked_in"},
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "refunded"},
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "cancelled"},
        ],
        ticket_holds=[
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "active", "quantity": 2, "expires_at": iso(1)},
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "active", "quantity": 5, "expires_at": iso(-1)},
            {"event_id": "ev-1", "ticket_type_id": "tt-1", "status": "converted", "quantity": 3, "expires_at": iso(1)},
        ],
    )


def test_tier_list_reports_every_count():
    r = run(db(), ORGANIZER, "get", "/api/organizer/events/ev-1/ticket-types")
    assert r.status_code == 200
    tier = r.json()[0]
    assert (tier["sold"], tier["available"]) == (2, 8)
    assert (tier["reserved"], tier["refunded"], tier["checked_in"]) == (2, 1, 1)


def test_other_organizer_is_denied():
    assert run(db(), OTHER_ORG, "get", "/api/organizer/events/ev-1/ticket-types").status_code == 403


def test_attendee_is_denied():
    assert run(db(), OTHER, "get", "/api/organizer/events/ev-1/ticket-types").status_code == 403
