"""FS-20: очередь писем для администратора платформы (доказательство доставки и ретрай).

GET  /api/admin/notifications/outbox?status=failed  – последние письма и их статус (без текста писем)
POST /api/admin/notifications/retry                 – переотправить pending / failed
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

import notify
from routers.admin import require_platform_admin
from schemas import CurrentUser

router = APIRouter(prefix="/api/admin/notifications", tags=["admin"])


@router.get("/outbox")
def outbox(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    admin: CurrentUser = Depends(require_platform_admin),
):
    q = notify.db.table("email_outbox").select(
        "id, dedupe_key, to_email, template, subject, status, attempts, last_error, created_at, sent_at"
    )
    if status_filter:
        q = q.eq("status", status_filter)
    return q.order("created_at", desc=True).limit(limit).execute().data or []


@router.post("/retry")
def retry(admin: CurrentUser = Depends(require_platform_admin)):
    return notify.retry_pending()
