import i18n, { formatEventDate } from '../i18n';
import { http } from './events';
import { API_BASE_URL } from './config';

export type TicketStatus = 'ACTIVE' | 'USED' | 'CANCELLED' | 'REFUNDED' | 'CANCEL_PENDING';

// билет из /api/me/tickets и /api/me/tickets/{id}
export interface MyTicket {
  id: string;
  order_id: string;
  event_id: string;
  event_title: string;
  event_status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_name: string;
  venue_address: string;
  ticket_type: string;
  attendee_name: string;
  seat: string | null;
  status: TicketStatus;
  checked_in_at: string | null;
  refund_case_id: string | null;
  qr_payload: string | null;
  purchased_at: string | null;
  promo_code: string | null;
  order_total_kzt: number;
}

export const ticketsApi = {
  mine: (token: string) => http<MyTicket[]>('/api/me/tickets', {}, token),
  one: (token: string, ticketId: string) => http<MyTicket>(`/api/me/tickets/${ticketId}`, {}, token),

  // PDF собирает сервер, тут просто скачиваем файл
  downloadPdf: async (token: string, ticketId: string) => {
    const lang = (i18n.language || 'ru').slice(0, 2);
    const res = await fetch(API_BASE_URL + '/api/me/tickets/' + ticketId + '/pdf?lang=' + lang, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.status === 401) window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    if (!res.ok) throw new Error('PDF (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'biletflow-ticket-' + ticketId.slice(0, 8) + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
  },

  // запрос на отмену = обращение в поддержку с категорией refund
  requestCancel: (token: string, ticket: { id: string; event_title: string }, reason: string) =>
    http<{ id: string }>(
      '/api/support/cases',
      {
        method: 'POST',
        body: JSON.stringify({
          category: 'refund',
          subject: i18n.t('orders.cancelSubject', { event: ticket.event_title }),
          message: reason.trim() || i18n.t('orders.cancelDefaultReason'),
          ticket_id: ticket.id,
        }),
      },
      token,
    ),
};

// ---- оформление заказа через холд (FS-17) ----
export interface Hold {
  hold_id: string;
  event_id: string;
  ticket_type_id: string;
  quantity: number;
  subtotal_kzt: number;
  discount_kzt: number;
  discount_percent: number;
  fee_kzt: number;
  total_kzt: number;
  hold_expires_at: string;
}

export interface AttendeeInput {
  name: string;
  email: string;
}

export type PaymentOutcome = 'approved' | 'declined';

export interface OrderResult {
  order_id: string;
  status: string;
  event_id: string;
  replayed: boolean;
  breakdown_kzt: { subtotal: number; discount: number; fee: number; total: number };
  tickets: { ticket_id: string; attendee_name: string | null; qr_payload: string }[];
}

export interface MyOrderTicket {
  id: string;
  status: TicketStatus;
  attendee_name: string | null;
  seat: string | null;
  checked_in_at: string | null;
  refund_case_id: string | null;
  qr_payload: string | null;
}

// заказ из /api/me/orders
export interface MyOrder {
  id: string;
  status: string;
  created_at: string | null;
  event: {
    id: string;
    title: string;
    status: string | null;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string;
    venue_name: string;
    venue_address: string;
  };
  ticket_type: { id: string; name: string; price_kzt: number };
  quantity: number;
  breakdown_kzt: { subtotal: number; discount: number; fee: number; total: number };
  promo_code: string | null;
  simulated_payment: boolean;
  tickets: MyOrderTicket[];
}

export const checkoutApi = {
  // резерв на 15 минут, цену и промокод считает сервер
  hold: (token: string, ticketTypeId: string, quantity: number, code?: string) =>
    http<Hold>(
      '/api/checkout/apply-promo',
      { method: 'POST', body: JSON.stringify({ ticket_type_id: ticketTypeId, quantity, code: code || null }) },
      token,
    ),

  release: (token: string, holdId: string) =>
    http<{ released: boolean }>(`/api/checkout/holds/${holdId}/release`, { method: 'POST' }, token),

  // повтор с тем же hold_id вернёт тот же заказ
  confirm: (token: string, holdId: string, outcome: PaymentOutcome, attendees: AttendeeInput[]) =>
    http<OrderResult>(
      '/api/orders',
      { method: 'POST', body: JSON.stringify({ hold_id: holdId, payment_outcome: outcome, attendees }) },
      token,
    ),

  order: (token: string, orderId: string) => http<MyOrder>(`/api/me/orders/${orderId}`, {}, token),
  orders: (token: string) => http<MyOrder[]>('/api/me/orders', {}, token),
};

const PROMO_KEY = 'campaign_promo';

// промокод из ссылки кампании (/events/:id?promo=CODE)
export const readCampaignPromo = () => {
  try { return sessionStorage.getItem(PROMO_KEY) ?? ''; } catch { return ''; }
};
export const saveCampaignPromo = (code: string) => {
  try { sessionStorage.setItem(PROMO_KEY, code.trim().toUpperCase()); } catch { /* storage unavailable */ }
};
export const clearCampaignPromo = () => {
  try { sessionStorage.removeItem(PROMO_KEY); } catch { /* storage unavailable */ }
};

export const formatEventDateTime = (iso: string | null, tz = 'Asia/Almaty') =>
  iso ? formatEventDate(iso, tz, 'full') : i18n.t('common.dateTBA');
