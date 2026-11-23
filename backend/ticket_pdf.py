"""PDF билета для печати (A4). Собирается на сервере из данных билета.

Всё чёрным по белому, чтобы QR читался и с чёрно-белой печати.
Email, цену и данные оплаты на билет не выводим.
Шрифт DejaVu Sans — в обычном Helvetica нет кириллицы и казахских букв.
"""
import io
import os
from datetime import datetime

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from zoneinfo import ZoneInfo

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
pdfmetrics.registerFont(TTFont("DejaVu", os.path.join(FONT_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")))

LABELS = {
    "ru": {
        "eticket": "Электронный билет", "date": "Дата и время", "venue": "Место проведения",
        "type": "Тип билета", "attendee": "Посетитель", "seat": "Место в зале", "id": "ID билета",
        "footer": "Покажите QR-код на входе. Электронная и печатная копии — один и тот же билет, пройти можно один раз.",
        "invalid": "БИЛЕТ НЕДЕЙСТВИТЕЛЕН",
        "status": {"REFUNDED": "Возвращён", "CANCELLED": "Отменён", "USED": "Уже использован"},
    },
    "kk": {
        "eticket": "Электрондық билет", "date": "Күні мен уақыты", "venue": "Өтетін орны",
        "type": "Билет түрі", "attendee": "Қатысушы", "seat": "Залдағы орын", "id": "Билет ID",
        "footer": "Кіреберісте QR-кодты көрсетіңіз. Электрондық және басылған көшірме — бір билет, оны бір рет қолдануға болады.",
        "invalid": "БИЛЕТ ЖАРАМСЫЗ",
        "status": {"REFUNDED": "Қайтарылды", "CANCELLED": "Тоқтатылды", "USED": "Пайдаланылды"},
    },
    "en": {
        "eticket": "E-ticket", "date": "Date and time", "venue": "Venue",
        "type": "Ticket type", "attendee": "Attendee", "seat": "Seat", "id": "Ticket ID",
        "footer": "Show the QR code at the entrance. The digital and printed copies are the same ticket and admit once.",
        "invalid": "TICKET IS NOT VALID",
        "status": {"REFUNDED": "Refunded", "CANCELLED": "Cancelled", "USED": "Already used"},
    },
}


def format_when(iso, tz_name):
    if not iso:
        return "—"
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    try:
        dt = dt.astimezone(ZoneInfo(tz_name))
    except Exception:
        pass
    return f"{dt:%d.%m.%Y %H:%M} ({tz_name})"


def wrap(text, font, size, width):
    # перенос по словам, чтобы длинное название не вылезало за колонку
    lines = []
    cur = ""
    for word in str(text).split():
        trial = (cur + " " + word).strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def render_ticket_pdf(ticket, lang="ru"):
    L = LABELS.get(lang, LABELS["ru"])
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"BiletFlow ticket {ticket['id']}")
    width, height = A4
    left = 20 * mm
    right = width - 20 * mm
    top = height - 20 * mm

    # пунктирная рамка
    c.setStrokeGray(0.4)
    c.setDash(4, 3)
    c.rect(left - 6 * mm, height - 190 * mm, right - left + 12 * mm, 176 * mm)
    c.setDash()

    # шапка
    c.setFillGray(0)
    c.setFont("DejaVu-Bold", 22)
    c.drawString(left, top - 6 * mm, "BILETFLOW")
    c.setFont("DejaVu", 10)
    c.drawString(left, top - 12 * mm, L["eticket"])
    c.setFont("DejaVu-Bold", 11)
    c.drawRightString(right, top - 6 * mm, ticket.get("ticket_type") or "")

    # слева — название и данные события
    col_w = 95 * mm
    y = top - 28 * mm
    c.setFont("DejaVu-Bold", 18)
    for line in wrap(ticket.get("event_title") or "", "DejaVu-Bold", 18, col_w)[:3]:
        c.drawString(left, y, line)
        y -= 8 * mm
    y -= 4 * mm

    venue = ", ".join(x for x in (ticket.get("venue_name"), ticket.get("venue_address")) if x) or "—"
    rows = [
        (L["date"], format_when(ticket.get("starts_at"), ticket.get("timezone") or "Asia/Almaty")),
        (L["venue"], venue),
        (L["type"], ticket.get("ticket_type") or "—"),
        (L["attendee"], ticket.get("attendee_name") or "—"),
    ]
    if ticket.get("seat"):
        rows.append((L["seat"], ticket["seat"]))

    for label, value in rows:
        c.setFont("DejaVu", 8)
        c.drawString(left, y, label.upper())
        y -= 5 * mm
        c.setFont("DejaVu-Bold", 12)
        for line in wrap(value, "DejaVu-Bold", 12, col_w)[:3]:
            c.drawString(left, y, line)
            y -= 5.5 * mm
        y -= 3 * mm

    # справа — QR (или надпись, что билет недействителен)
    qr_size = 70 * mm
    qx = right - qr_size
    qy = top - 28 * mm - qr_size
    if ticket.get("qr_payload"):
        widget = QrCodeWidget(ticket["qr_payload"], barLevel="M", barBorder=4)  # barBorder — белая рамка вокруг QR
        x1, y1, x2, y2 = widget.getBounds()
        d = Drawing(qr_size, qr_size, transform=[qr_size / (x2 - x1), 0, 0, qr_size / (y2 - y1), 0, 0])
        d.add(widget)
        renderPDF.draw(d, c, qx, qy)
    else:
        c.setLineWidth(2)
        c.rect(qx, qy, qr_size, qr_size)
        c.setFont("DejaVu-Bold", 13)
        i = 0
        for line in wrap(L["invalid"], "DejaVu-Bold", 13, qr_size - 8 * mm):
            c.drawCentredString(qx + qr_size / 2, qy + qr_size / 2 + 6 * mm - i * 7 * mm, line)
            i += 1
        c.setFont("DejaVu", 11)
        status_text = L["status"].get(ticket.get("status"), ticket.get("status") or "")
        c.drawCentredString(qx + qr_size / 2, qy + 10 * mm, status_text)

    # внизу ID (такой же, как в QR) и подсказка
    c.setFont("DejaVu", 8)
    c.drawString(left, height - 180 * mm, f"{L['id']}: {ticket['id']}")
    fy = height - 185 * mm
    for line in wrap(L["footer"], "DejaVu", 8, right - left):
        c.drawString(left, fy, line)
        fy -= 4 * mm

    c.showPage()
    c.save()
    return buf.getvalue()
