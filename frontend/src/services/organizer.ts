import { http } from './events';

export type Phase = 'upcoming' | 'active' | 'completed' | 'cancelled';

export interface OrganizerEvent {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  venue_name: string | null;
  venue_address: string | null;
  image_url: string | null;
  visibility: 'public' | 'unlisted' | 'private' | null;
  capacity: number | null;
  status: 'draft' | 'published' | 'cancelled';
  paid_sales_status?: 'NONE' | 'ACTIVE' | 'SUSPENDED';
}

export interface OrganizerTicketType {
  id: string;
  event_id: string;
  name: string | null;
  description: string | null;
  price: number | null;
  quantity: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  max_per_order: number | null;
  is_hidden: boolean | null;
  sold: number;
  available: number | null;
}

export interface EventAnalytics {
  event: {
    id: string; title: string | null; status: string; phase: Phase;
    starts_at: string | null; ends_at: string | null; timezone: string; paid_sales_status: string;
  };
  filters: { date_from: string | null; date_to: string | null; ticket_type_id: string | null };
  capacity: { total: number | null; sold: number; remaining: number | null; percent_sold: number | null };
  revenue: {
    currency: 'KZT'; simulated: boolean; gross_kzt: number; discounts_kzt: number;
    fees_kzt: number; refunds_kzt: number; net_kzt: number; orders: number;
  };
  attendance: { registered: number; checked_in: number; absent: number; percent_checked_in: number | null };
  cancellations: { cancelled: number; refunded: number };
  sales_over_time?: { date: string; tickets: number; revenue_kzt: number; cumulative_tickets: number }[];
  by_ticket_type: {
    ticket_type_id: string; name: string; price_kzt: number; capacity: number | null; sold: number;
    remaining: number | null; percent_sold: number | null; revenue_kzt: number; checked_in: number; is_hidden: boolean;
  }[];
  campaigns: { code: string; redemptions: number; tickets: number; gross_kzt: number; discount_kzt: number; net_kzt: number }[];
}

export interface DashboardResponse {
  totals: {
    events: number;
    by_phase: Record<Phase, number>;
    tickets_sold: number;
    capacity: number;
    capacity_unlimited_events: number;
    gross_kzt: number;
    discounts_kzt: number;
    refunds_kzt: number;
    net_kzt: number;
    checked_in: number;
    percent_checked_in: number | null;
    promo_redemptions: number;
  };
  events: EventAnalytics[];
}

export type EventInput = Partial<Omit<OrganizerEvent, 'id' | 'status' | 'paid_sales_status'>>;
export type TicketTypeInput = Partial<Omit<OrganizerTicketType, 'id' | 'event_id' | 'sold' | 'available'>>;

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const organizerApi = {
  dashboard: (token: string) => http<DashboardResponse>('/api/organizer/dashboard', {}, token),

  analytics: (token: string, eventId: string, f: { date_from?: string; date_to?: string; ticket_type_id?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    return http<EventAnalytics>(`/api/organizer/events/${eventId}/analytics${q ? `?${q}` : ''}`, {}, token);
  },

  events: (token: string) => http<OrganizerEvent[]>('/api/organizer/events', {}, token),
  createEvent: (token: string, body: EventInput) =>
    http<OrganizerEvent>('/api/organizer/events', { method: 'POST', ...json(body) }, token),
  updateEvent: (token: string, id: string, body: EventInput) =>
    http<OrganizerEvent>(`/api/organizer/events/${id}`, { method: 'PATCH', ...json(body) }, token),
  publish: (token: string, id: string) => http<OrganizerEvent>(`/api/organizer/events/${id}/publish`, { method: 'POST' }, token),
  unpublish: (token: string, id: string) => http<OrganizerEvent>(`/api/organizer/events/${id}/unpublish`, { method: 'POST' }, token),
  cancel: (token: string, id: string) => http<OrganizerEvent>(`/api/organizer/events/${id}/cancel`, { method: 'POST' }, token),

  ticketTypes: (token: string, eventId: string) =>
    http<OrganizerTicketType[]>(`/api/organizer/events/${eventId}/ticket-types`, {}, token),
  createTicketType: (token: string, eventId: string, body: TicketTypeInput) =>
    http<OrganizerTicketType>(`/api/organizer/events/${eventId}/ticket-types`, { method: 'POST', ...json(body) }, token),
  updateTicketType: (token: string, id: string, body: TicketTypeInput) =>
    http<OrganizerTicketType>(`/api/organizer/ticket-types/${id}`, { method: 'PATCH', ...json(body) }, token),

  activatePaidSales: (token: string, eventId: string) =>
    http<{ status: string; paid_sales_status: string; checklist?: Record<string, { passed: boolean; detail?: string }> }>(
      `/api/organizer/events/${eventId}/activate-paid-sales`,
      { method: 'POST', ...json({ paid_event_terms_accepted: true }) },
      token,
    ),
};

export const PHASE_LABEL: Record<Phase, string> = {
  upcoming: 'Предстоящее',
  active: 'Идёт сейчас',
  completed: 'Завершено',
  cancelled: 'Отменено',
};

export const STATUS_LABEL: Record<OrganizerEvent['status'], string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
  cancelled: 'Отменено',
};

/** `<input type="datetime-local">` ↔ ISO, in the event's wall time (Asia/Almaty, UTC+5 by default). */
export const toLocalInput = (iso: string | null, offsetHours = 5) =>
  iso ? new Date(new Date(iso).getTime() + offsetHours * 3600_000).toISOString().slice(0, 16) : '';
export const fromLocalInput = (v: string, offset = '+05:00') => (v ? `${v}:00${offset}` : null);
