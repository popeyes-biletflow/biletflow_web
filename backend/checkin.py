"""Check-in and undo through the atomic database functions (migration 019)."""
from typing import Any, Optional

from fastapi import HTTPException, status

from deps import sanitize_error

ERROR_STATUS = {
    "NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "WRONG_EVENT": status.HTTP_400_BAD_REQUEST,
    "ALREADY_USED": status.HTTP_409_CONFLICT,
    "INVALID_STATUS": status.HTTP_400_BAD_REQUEST,
    "NOT_CHECKED_IN": status.HTTP_400_BAD_REQUEST,
    "FORBIDDEN": status.HTTP_403_FORBIDDEN,
}


def _call(client: Any, function: str, ticket_id: str, event_id: str, staff_id: str,
          overrides: Optional[dict[str, tuple[int, str]]] = None) -> dict:
    try:
        res = client.rpc(function, {
            "p_ticket_id": str(ticket_id),
            "p_event_id": str(event_id),
            "p_staff_id": str(staff_id),
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sanitize_error(exc),
        )

    data = res.data
    if isinstance(data, list):
        data = data[0] if data else None
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The check-in service returned an unexpected response.",
        )

    if data.get("success") is True:
        return data

    code = data.get("error_code") or ""
    if overrides and code in overrides:
        http_status, message = overrides[code]
    else:
        http_status = ERROR_STATUS.get(code, status.HTTP_400_BAD_REQUEST)
        message = data.get("message") or "Check-in was rejected."
    raise HTTPException(status_code=http_status, detail=message)


def checkin_ticket(client: Any, ticket_id: str, event_id: str, staff_id: str,
                   overrides: Optional[dict[str, tuple[int, str]]] = None) -> dict:
    return _call(client, "checkin_ticket_atomic", ticket_id, event_id, staff_id, overrides)


def undo_checkin(client: Any, ticket_id: str, event_id: str, staff_id: str) -> dict:
    return _call(client, "undo_checkin_atomic", ticket_id, event_id, staff_id)
