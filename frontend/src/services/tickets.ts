import { http } from './events';

/** Row returned by GET /api/me/tickets */
export interface MyTicket {
  id: string;
  order_id: string;
  event_id: string;
  event_title: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_name: string;
  venue_address: string;
  ticket_type: string;
  subtotal_kzt: number;
  discount_kzt: number;
  fee_kzt: number;
  total_kzt: number;
  promo_code: string | null;
  purchased_at: string | null;
  status: 'ACTIVE' | 'USED' | 'CANCELLED' | 'CANCEL_PENDING';
  refund_case_id: string | null;
  checked_in_at: string | null;
  qr_payload: string | null;
}

export interface Quote {
  ticket_type_id: string;
  subtotal_kzt: number;
  discount_kzt: number;
  fee_kzt: number;
  total_kzt: number;
  promo_code: string | null;
  discount_percent: number;
  simulated: boolean;
}

export interface IssuedTicket {
  id: string;
  order_id: string;
  ticket_type_id: string;
  event_id: string;
  status: string;
  qr_payload: string;
  pricing: Quote | null;
}

export const ticketsApi = {
  mine: (token: string) => http<MyTicket[]>('/api/me/tickets', {}, token),

  quote: (token: string, eventId: string, ticketTypeId: string, promoCode?: string) =>
    http<Quote>(
      `/api/events/${eventId}/checkout/quote`,
      { method: 'POST', body: JSON.stringify({ ticket_type_id: ticketTypeId, promo_code: promoCode || null }) },
      token,
    ),

  register: (token: string, eventId: string, ticketTypeId: string, promoCode?: string) =>
    http<IssuedTicket>(
      `/api/events/${eventId}/register`,
      { method: 'POST', body: JSON.stringify({ ticket_type_id: ticketTypeId, promo_code: promoCode || null }) },
      token,
    ),

  /** Cancellation / refund request = support case with category "refund" linked to the ticket (SRS 4.9, 4.13). */
  requestCancel: (token: string, ticket: MyTicket, reason: string) =>
    http<{ id: string }>(
      '/api/support/cases',
      {
        method: 'POST',
        body: JSON.stringify({
          category: 'refund',
          subject: `Отмена билета: ${ticket.event_title}`,
          message: reason.trim() || 'Прошу отменить билет.',
          ticket_id: ticket.id,
        }),
      },
      token,
    ),
};

const PROMO_KEY = 'campaign_promo';

/** Promo code that arrived through a Campaign QR link (/checkout?promo=CODE), if any. */
export const readCampaignPromo = () => {
  try { return sessionStorage.getItem(PROMO_KEY) ?? ''; } catch { return ''; }
};
export const saveCampaignPromo = (code: string) => {
  try { sessionStorage.setItem(PROMO_KEY, code.trim().toUpperCase()); } catch { /* storage unavailable */ }
};
export const clearCampaignPromo = () => {
  try { sessionStorage.removeItem(PROMO_KEY); } catch { /* storage unavailable */ }
};

export const formatEventDateTime =(iso: string | null, tz = 'Asia/Almaty') =>
  iso
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: tz }).format(new Date(iso))
    : 'Дата уточняется';
