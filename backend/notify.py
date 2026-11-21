"""FS-20: уведомления и письма.

notify() делает две вещи:
  1) запись в таблицу notifications (колокольчик на сайте)
  2) письмо: сначала строка в email_outbox, потом отправка по SMTP

У каждого уведомления есть dedupe_key, поэтому повтор запроса не шлёт второе письмо.
Если SMTP упал — письмо помечается failed, заказ не откатывается. Потом retry_pending()
отправит его ещё раз (POST /api/admin/notifications/retry или `python notify.py retry`).

Для демо почты: docker run -p 1025:1025 -p 8025:8025 axllent/mailpit  → http://localhost:8025
Настройки в .env: SMTP_HOST, SMTP_PORT, EMAIL_FROM, EMAIL_ENABLED, EMAIL_LANG, SUPABASE_SERVICE_KEY
"""
import html
import logging
import os
import re
import smtplib
import sys
from datetime import datetime, timezone
from email.message import EmailMessage

from dotenv import load_dotenv

load_dotenv()

from deps import SUPABASE_URL, VERIFY_SSL, supabase as anon_client  # noqa: E402

logger = logging.getLogger("biletflow.notify")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST", "localhost")
SMTP_PORT = int(os.getenv("SMTP_PORT", "1025"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "false").lower() in ("1", "true", "yes")
EMAIL_FROM = os.getenv("EMAIL_FROM", "BiletFlow <no-reply@biletflow.local>")
EMAIL_ENABLED = os.getenv("EMAIL_ENABLED", "true").lower() in ("1", "true", "yes")
EMAIL_LANG = os.getenv("EMAIL_LANG", "ru")
# копия каждого письма в .eml (удобно для отчёта), пусто = не сохранять
PREVIEW_DIR = os.getenv("EMAIL_PREVIEW_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "outbox_previews"))
MAX_ATTEMPTS = 5


def make_client():
    # для email_outbox и email получателей нужен service key (anon ключ их не видит из-за RLS)
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not key:
        return anon_client
    import httpx
    from supabase import ClientOptions, create_client
    return create_client(SUPABASE_URL, key, options=ClientOptions(httpx_client=httpx.Client(verify=VERIFY_SSL)))


db = make_client()

# шаблоны писем: (тема, текст). {url} — главная ссылка, {ticket_links} — ссылки на билеты
TEMPLATES = {
    "REGISTRATION_CONFIRMED": {
        "ru": ("Вы зарегистрированы: {event_title}",
               "Регистрация на «{event_title}» подтверждена.\n{event_date}, {venue}\n\nВаши билеты:\n{ticket_links}\n\nОплата не требовалась."),
        "kk": ("Сіз тіркелдіңіз: {event_title}",
               "«{event_title}» іс-шарасына тіркелу расталды.\n{event_date}, {venue}\n\nБилеттеріңіз:\n{ticket_links}\n\nТөлем қажет болмады."),
        "en": ("You are registered: {event_title}",
               "Your registration for “{event_title}” is confirmed.\n{event_date}, {venue}\n\nYour tickets:\n{ticket_links}\n\nNo payment was needed."),
    },
    "PURCHASE_CONFIRMED": {
        "ru": ("Заказ оплачен: {event_title}",
               "Спасибо! Заказ #{order_short} на «{event_title}» оплачен (демо-оплата, деньги не списывались).\nИтого: {total}\n{event_date}, {venue}\n\nВаши билеты:\n{ticket_links}"),
        "kk": ("Тапсырыс төленді: {event_title}",
               "Рақмет! «{event_title}» бойынша #{order_short} тапсырысы төленді (демо төлем, ақша алынған жоқ).\nБарлығы: {total}\n{event_date}, {venue}\n\nБилеттеріңіз:\n{ticket_links}"),
        "en": ("Order paid: {event_title}",
               "Thank you! Order #{order_short} for “{event_title}” is paid (demo payment, no money was charged).\nTotal: {total}\n{event_date}, {venue}\n\nYour tickets:\n{ticket_links}"),
    },
    "TICKET_DELIVERY": {
        "ru": ("Ваш билет на «{event_title}»",
               "{buyer} оформил(а) для вас билет на «{event_title}».\n{event_date}, {venue}\n\nБилет: {url}"),
        "kk": ("«{event_title}» билетіңіз",
               "{buyer} сізге «{event_title}» іс-шарасына билет рәсімдеді.\n{event_date}, {venue}\n\nБилет: {url}"),
        "en": ("Your ticket for “{event_title}”",
               "{buyer} got you a ticket for “{event_title}”.\n{event_date}, {venue}\n\nTicket: {url}"),
    },
    "PAYMENT_FAILED": {
        "ru": ("Оплата не прошла: {event_title}",
               "Банк отклонил оплату заказа на «{event_title}» (демо). Билеты ещё зарезервированы до {hold_until} — попробуйте снова: {url}"),
        "kk": ("Төлем өтпеді: {event_title}",
               "Банк «{event_title}» тапсырысының төлемін қабылдамады (демо). Билеттер {hold_until} дейін брондалған — қайталап көріңіз: {url}"),
        "en": ("Payment failed: {event_title}",
               "The bank declined the payment for “{event_title}” (demo). Your tickets stay reserved until {hold_until} — try again: {url}"),
    },
    "EVENT_UPDATED": {
        "ru": ("Изменения в событии «{event_title}»",
               "Организатор обновил событие «{event_title}».\nТеперь: {event_date}, {venue}\n\nВаши билеты остаются действительными. Подробнее: {url}"),
        "kk": ("«{event_title}» іс-шарасында өзгерістер",
               "Ұйымдастырушы «{event_title}» іс-шарасын жаңартты.\nЕнді: {event_date}, {venue}\n\nБилеттеріңіз жарамды. Толығырақ: {url}"),
        "en": ("Changes to “{event_title}”",
               "The organizer updated “{event_title}”.\nNow: {event_date}, {venue}\n\nYour tickets are still valid. Details: {url}"),
    },
    "EVENT_CANCELLED": {
        "ru": ("Событие отменено: {event_title}",
               "К сожалению, «{event_title}» ({event_date}) отменено. Билеты больше недействительны. Вопросы по возврату можно задать в поддержке: {url}"),
        "kk": ("Іс-шара тоқтатылды: {event_title}",
               "Өкінішке қарай, «{event_title}» ({event_date}) тоқтатылды. Билеттер енді жарамсыз. Қайтару бойынша сұрақтарды қолдау қызметіне жазыңыз: {url}"),
        "en": ("Event cancelled: {event_title}",
               "Unfortunately “{event_title}” ({event_date}) is cancelled. The tickets are no longer valid. Ask support about refunds: {url}"),
    },
    "REFUND_COMPLETED": {
        "ru": ("Возврат оформлен: {event_title}",
               "Возврат по билету на «{event_title}» оформлен (демо, деньги не переводятся). Сумма: {total}. Билет больше недействителен: {url}"),
        "kk": ("Қайтару рәсімделді: {event_title}",
               "«{event_title}» билеті бойынша қайтару рәсімделді (демо, ақша аударылмайды). Сомасы: {total}. Билет енді жарамсыз: {url}"),
        "en": ("Refund completed: {event_title}",
               "Your refund for “{event_title}” is done (demo, no money moves). Amount: {total}. The ticket is no longer valid: {url}"),
    },
    "PAYOUT_STATUS": {
        "ru": ("Платные продажи: {status}",
               "Статус платных продаж и выплат для «{event_title}»: {status}. {reason}\nКабинет организатора: {url}"),
        "kk": ("Ақылы сату: {status}",
               "«{event_title}» үшін ақылы сату мен төлемдер күйі: {status}. {reason}\nҰйымдастырушы кабинеті: {url}"),
        "en": ("Paid sales: {status}",
               "Paid sales and payout status for “{event_title}”: {status}. {reason}\nOrganizer dashboard: {url}"),
    },
    # обращения в поддержку — заголовок и текст приходят из support.py
    "SUPPORT": {
        "ru": ("BiletFlow поддержка: {title}", "{message}\n\nОткрыть обращение: {url}"),
        "kk": ("BiletFlow қолдау: {title}", "{message}\n\nӨтінішті ашу: {url}"),
        "en": ("BiletFlow support: {title}", "{message}\n\nOpen the case: {url}"),
    },
}


SUPPORT_TYPES = [
    "SUPPORT_CASE_CREATED", "SUPPORT_REPLY_RECEIVED", "SUPPORT_CASE_STATUS_CHANGED",
    "SUPPORT_CASE_ASSIGNED", "SUPPORT_CASE_ESCALATED",
]


class SafeDict(dict):
    # если в ctx нет какого-то поля — подставляем пустую строку, а не падаем
    def __missing__(self, key):
        return ""


def render(template, ctx, lang=EMAIL_LANG):
    """Возвращает (тема, текст, html) письма."""
    key = "SUPPORT" if template in SUPPORT_TYPES else template
    variants = TEMPLATES[key]
    subject_t, text_t = variants.get(lang) or variants["ru"]
    values = SafeDict()
    for k, v in ctx.items():
        values[k] = "" if v is None else v
    subject = subject_t.format_map(values).strip()
    text = text_t.format_map(values).strip()

    # html — тот же текст, только ссылки кликабельные
    body = html.escape(text).replace("\n", "<br>")
    body = re.sub(r"(https?://[^\s<]+)", r'<a href="\1" style="color:#1d4ed8">\1</a>', body)
    page = (
        '<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:560px">'
        '<p style="font-size:20px;font-weight:bold;margin:0 0 16px">BiletFlow</p>'
        f"<p>{body}</p>"
        '<p style="color:#666;font-size:12px;margin-top:24px">BiletFlow · demo / учебный проект. Платежи симулированы.</p>'
        "</body></html>"
    )
    return subject, text, page


def build_message(to_email, subject, text, page):
    msg = EmailMessage()
    msg["From"] = EMAIL_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(page, subtype="html")
    return msg


def send_smtp(msg):
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=5) as s:
        if SMTP_STARTTLS:
            s.starttls()
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


def save_preview(dedupe_key, msg):
    if not PREVIEW_DIR:
        return
    try:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9_.-]+", "_", dedupe_key)[:120]
        with open(os.path.join(PREVIEW_DIR, name + ".eml"), "wb") as f:
            f.write(bytes(msg))
    except OSError as e:
        logger.warning("could not write email preview: %s", e)


def lookup_email(user_id):
    try:
        rows = db.table("profiles").select("email").eq("id", user_id).execute().data or []
        if rows:
            return rows[0].get("email")
    except Exception:
        pass
    return None


def is_duplicate(e):
    text = str(e).lower()
    return "duplicate" in text or "23505" in text or "unique" in text


def deliver(row):
    """Отправить письмо из outbox и записать результат. Исключения наружу не бросает."""
    msg = build_message(row["to_email"], row["subject"], row["body_text"], row["body_html"])
    save_preview(row["dedupe_key"], msg)
    attempts = int(row.get("attempts") or 0) + 1
    try:
        if not EMAIL_ENABLED:
            raise RuntimeError("EMAIL_ENABLED=false")
        send_smtp(msg)
    except Exception as e:
        logger.warning("email %s failed: %s", row["dedupe_key"], e)
        try:
            db.table("email_outbox").update({"status": "failed", "attempts": attempts, "last_error": str(e)[:500]}) \
                .eq("dedupe_key", row["dedupe_key"]).execute()
        except Exception:
            pass
        return False

    try:
        db.table("email_outbox").update({
            "status": "sent",
            "attempts": attempts,
            "last_error": None,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }).eq("dedupe_key", row["dedupe_key"]).execute()
    except Exception:
        pass
    return True


def notify(template, user_id, ctx, dedupe_key, email=None, lang=EMAIL_LANG, in_app=True, data=None):
    """Уведомление на сайте + письмо. Возвращает что получилось (нужно для тестов)."""
    result = {"in_app": False, "email": None}
    if ctx.get("path") and not ctx.get("url"):
        ctx = {**ctx, "url": FRONTEND_URL + ctx["path"]}
    subject, text, page = render(template, ctx, lang)

    # 1. на сайте (колокольчик)
    if in_app and user_id:
        extra = dict(data or {})
        if ctx.get("path"):
            extra["url"] = ctx["path"]
        try:
            db.table("notifications").insert({
                "user_id": user_id,
                "type": template,
                "title": ctx.get("title") or subject,
                "message": (ctx.get("message") or text.splitlines()[0])[:300],
                "data": extra,
                "read": False,
                "dedupe_key": dedupe_key,
            }).execute()
            result["in_app"] = True
        except Exception as e:
            if not is_duplicate(e):
                logger.warning("in-app notification %s failed: %s", dedupe_key, e)

    # 2. письмо
    if not EMAIL_ENABLED:
        return result
    to_email = email
    if not to_email and user_id:
        to_email = lookup_email(user_id)
    if not to_email:
        return result

    row = {
        "dedupe_key": dedupe_key, "user_id": user_id, "to_email": to_email, "template": template,
        "subject": subject, "body_text": text, "body_html": page, "status": "pending", "attempts": 0,
    }
    try:
        db.table("email_outbox").insert(row).execute()
    except Exception as e:
        if is_duplicate(e):
            result["email"] = "duplicate"  # такое письмо уже было
            return result
        logger.warning("outbox insert %s failed (%s), sending without outbox", dedupe_key, e)

    result["email"] = "sent" if deliver(row) else "failed"
    return result


def retry_pending(limit=50):
    """Переотправить письма, которые не ушли (SMTP был недоступен)."""
    rows = db.table("email_outbox").select("*").neq("status", "sent").order("created_at").limit(limit).execute().data or []
    stats = {"sent": 0, "failed": 0, "skipped": 0}
    for row in rows:
        if int(row.get("attempts") or 0) >= MAX_ATTEMPTS:
            stats["skipped"] += 1
        elif deliver(row):
            stats["sent"] += 1
        else:
            stats["failed"] += 1
    return stats


# ---- хелперы для конкретных событий ----

def event_ctx(event):
    from ticket_pdf import format_when
    venue = ", ".join(x for x in (event.get("venue_name"), event.get("venue_address")) if x)
    return {
        "event_title": event.get("title") or "BiletFlow",
        "event_date": format_when(event.get("starts_at"), event.get("timezone") or "Asia/Almaty"),
        "venue": venue,
    }


def notify_order_confirmed(order, event, buyer_id, buyer_email, buyer_name, tickets, lang=EMAIL_LANG):
    """Покупателю — одно письмо со ссылками на все билеты. Остальным посетителям — их билет."""
    total = int(order.get("total_amount") or 0)
    links = "\n".join(f"• {FRONTEND_URL}/tickets/{t['ticket_id']}" for t in tickets)
    ctx = event_ctx(event)
    ctx["order_short"] = str(order["id"])[:8]
    ctx["total"] = f"{total:,} ₸".replace(",", " ")
    ctx["ticket_links"] = links
    ctx["path"] = f"/orders/{order['id']}"

    template = "REGISTRATION_CONFIRMED" if total == 0 else "PURCHASE_CONFIRMED"
    notify(template, buyer_id, ctx, f"order:{order['id']}:confirmed", email=buyer_email, lang=lang,
           data={"order_id": str(order["id"])})

    for t in tickets:
        att = (t.get("attendee_email") or "").strip().lower()
        if att and att != (buyer_email or "").strip().lower():
            ctx2 = event_ctx(event)
            ctx2["buyer"] = buyer_name
            ctx2["path"] = f"/tickets/{t['ticket_id']}"
            notify("TICKET_DELIVERY", None, ctx2, f"ticket:{t['ticket_id']}:delivery", email=att, lang=lang, in_app=False)


def notify_event_holders(db_user, event, template, dedupe_suffix):
    """Всем, у кого есть билет на событие (изменение или отмена). Каждому один раз."""
    rows = db_user.table("tickets").select("id, user_id, attendee_email, status").eq("event_id", event["id"]).execute().data or []
    done = set()
    for t in rows:
        if (t.get("status") or "").lower() == "refunded":
            continue
        uid = str(t["user_id"])
        if uid in done:
            continue
        done.add(uid)
        ctx = event_ctx(event)
        ctx["path"] = f"/events/{event['id']}" if template == "EVENT_UPDATED" else "/support"
        notify(template, uid, ctx, f"event:{event['id']}:{dedupe_suffix}:{uid}")
    return len(done)


def write_previews(out_dir):
    """Все шаблоны на трёх языках с тестовыми данными — для отчёта."""
    sample = {
        "event_title": "Наурыз концерті", "event_date": "20.12.2026 19:00 (Asia/Almaty)",
        "venue": "Astana Arena, Қабанбай батыр 45", "order_short": "8f29602a", "total": "12 600 ₸",
        "ticket_links": f"• {FRONTEND_URL}/tickets/7f3c2a10-5b1e-4c7a-9d2e-1a2b3c4d5e6f",
        "url": f"{FRONTEND_URL}/orders/8f29602a", "buyer": "Demo Attendee", "hold_until": "19:15",
        "status": "ACTIVE", "reason": "Demo payout account verified.", "title": "New reply on case: Refund please",
        "message": "We will refund you today.",
    }
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for tpl in TEMPLATES:
        for lang in ("kk", "ru", "en"):
            subject, _, page = render(tpl, sample, lang)
            path = os.path.join(out_dir, f"{tpl.lower()}_{lang}.html")
            with open(path, "w", encoding="utf-8") as f:
                f.write(page.replace("<body", f"<!-- Subject: {html.escape(subject)} --><body", 1))
            files.append(path)
    return files


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "retry":
        print(retry_pending())
    elif len(sys.argv) > 1 and sys.argv[1] == "previews":
        out = sys.argv[2] if len(sys.argv) > 2 else "email_previews"
        print("\n".join(write_previews(out)))
    else:
        print("usage: python notify.py retry | previews [out_dir]")
