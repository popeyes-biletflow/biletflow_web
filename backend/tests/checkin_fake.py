"""In-memory versions of checkin_ticket_atomic / undo_checkin_atomic (migration 019)."""
from types import SimpleNamespace


def _is_admin(tables, uid):
    return any(
        str(p.get("id")) == str(uid) and str(p.get("role", "")).lower() in ("platform_admin", "admin")
        for p in tables.get("profiles", [])
    )


def _can_manage(tables, event_id, uid, for_undo):
    if _is_admin(tables, uid):
        return True
    if any(str(e.get("id")) == str(event_id) and str(e.get("organizer_id")) == str(uid)
           for e in tables.get("events", [])):
        return True
    return any(
        str(s.get("event_id")) == str(event_id) and str(s.get("user_id")) == str(uid)
        and (not for_undo or s.get("can_undo") is not False)
        for s in tables.get("event_staff", [])
    )


def _fail(code, message):
    return {"success": False, "error_code": code, "message": message}


def checkin(tables, params):
    tid, eid, uid = params["p_ticket_id"], params["p_event_id"], params["p_staff_id"]
    if not _can_manage(tables, eid, uid, False):
        return _fail("FORBIDDEN", "You are not assigned to manage check-ins for this event.")
    rows = [t for t in tables.get("tickets", []) if str(t.get("id")) == str(tid)]
    if not rows:
        return _fail("NOT_FOUND", "Ticket not found.")
    t = rows[0]
    if str(t.get("event_id")) != str(eid):
        return _fail("WRONG_EVENT", "This ticket belongs to a different event.")
    if t.get("status") == "checked_in":
        return _fail("ALREADY_USED", "Ticket has already been used.")
    if t.get("status") in ("cancelled", "refunded"):
        return _fail("INVALID_STATUS", "Ticket is cancelled or refunded.")
    if t.get("status") != "valid":
        return _fail("INVALID_STATUS", "Ticket is not valid for entry.")
    t.update(status="checked_in", checked_in_by=uid)
    tables.setdefault("audit_log", []).append(
        {"action": "TICKET_CHECKIN", "performed_by": uid, "entity_type": "ticket", "entity_id": str(tid)})
    return {"success": True, "ticket_id": tid, "message": "Check-in successful"}


def undo(tables, params):
    tid, eid, uid = params["p_ticket_id"], params["p_event_id"], params["p_staff_id"]
    if not _can_manage(tables, eid, uid, True):
        return _fail("FORBIDDEN", "You are not allowed to undo check-ins for this event.")
    rows = [t for t in tables.get("tickets", []) if str(t.get("id")) == str(tid)]
    if not rows:
        return _fail("NOT_FOUND", "Ticket not found.")
    t = rows[0]
    if str(t.get("event_id")) != str(eid):
        return _fail("WRONG_EVENT", "Ticket does not belong to this event.")
    if t.get("status") != "checked_in":
        return _fail("NOT_CHECKED_IN", "Ticket is not checked in.")
    t.update(status="valid", checked_in_at=None, checked_in_by=None)
    tables.setdefault("audit_log", []).append(
        {"action": "TICKET_CHECKIN_REVERSED", "performed_by": uid, "entity_type": "ticket", "entity_id": str(tid)})
    return {"success": True, "ticket_id": tid, "message": "Check-in undone"}


RPCS = {"checkin_ticket_atomic": checkin, "undo_checkin_atomic": undo}


class Execution:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return SimpleNamespace(data=self.data)


def call(tables, name, params):
    return Execution(RPCS[name](tables, params))
