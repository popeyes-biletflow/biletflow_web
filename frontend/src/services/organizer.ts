import { http } from './events';
import { API_BASE_URL } from './config';

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
  visibility: Visibility | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  capacity: number | null;
  status: 'draft' | 'published' | 'cancelled';
  paid_sales_status?: 'NONE' | 'ACTIVE' | 'SUSPENDED';
}

export type Visibility = 'public' | 'unlisted' | 'private';

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
  reserved?: number;
  refunded?: number;
  checked_in?: number;
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

export const CHECKLIST_KEYS = [
  'at_least_one_paid_ticket_type',
  'valid_payout_account',
  'identity_verified',
  'activation_fee_paid',
  'paid_event_terms_accepted',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export type Checklist = Partial<Record<ChecklistKey, { passed: boolean; detail?: string; amount_kzt?: number }>>;

export interface ActivationResult {
  status: 'activated' | 'already_active';
  paid_sales_status: 'ACTIVE';
  activation_fee_kzt?: number;
  checklist?: Checklist;
}

export interface ActivationStatus {
  event_id: string;
  paid_sales_status: 'NONE' | 'ACTIVE' | 'SUSPENDED';
  paid_sales_active: boolean;
  activation_fee_kzt: number;
  simulated: boolean;
  checklist: Partial<Record<Exclude<ChecklistKey, 'paid_event_terms_accepted'>, { passed: boolean; simulated?: boolean; amount_kzt?: number }>>;
}

export type CampaignState = 'active' | 'scheduled' | 'expired' | 'disabled';
export type DiscountType = 'percent' | 'fixed_kzt';

export interface Campaign {
  campaign_id: string;
  event_id: string;
  name: string;
  code: string;
  discount_percent: number | null;
  discount_type?: DiscountType;
  discount_value?: number | null;
  ticket_type_id?: string | null;
  max_uses: number;
  starts_at?: string | null;
  ends_at?: string | null;
  is_disabled?: boolean;
  state?: CampaignState;
  qr_link?: string | null;
  qr_scans: number;
  orders: number;
  tickets_sold: number;
  gross_sales_kzt: number;
  discount_total_kzt: number;
  net_revenue_kzt: number;
  conversion_rate?: number | null;
}

export interface CampaignInput {
  event_id: string;
  name: string;
  code: string;
  max_uses: number;
  ends_at: string;
  starts_at?: string | null;
  discount_percent?: number;
  discount_type?: DiscountType;
  discount_value?: number;
  ticket_type_id?: string | null;
}

export interface HistoryEntry {
  id: string | number;
  action: string;
  created_at: string;
  performed_by: string | null;
  performed_by_name: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Attendee {
  ticket_id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  ticket_type: string | null;
  status: string;
  order_id: string | null;
  checked_in_at: string | null;
  created_at: string | null;
}

export interface AttendeePage {
  total: number;
  limit: number;
  offset: number;
  items: Attendee[];
}

export interface DuplicateResult {
  event_id: string;
  source_event_id: string;
  status: 'draft';
  ticket_types_copied: number;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  payout_info: string | null;
  role: string | null;
}
export type TicketTypeInput = Partial<Omit<OrganizerTicketType, 'id' | 'event_id' | 'sold' | 'available' | 'reserved' | 'refunded' | 'checked_in'>>;

let specProbe: Promise<Record<string, unknown>> | null = null;

export function apiSupports(path: string): Promise<boolean> {
  specProbe ??= fetch(`${API_BASE_URL}/openapi.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((spec) => (spec?.paths ?? {}) as Record<string, unknown>)
    .catch(() => ({}));
  return specProbe.then((paths) => path in paths);
}

export const campaignUpgradeAvailable = () => apiSupports('/api/campaigns/{campaign_id}/disabled');

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

  activatePaidSales: (token: string, eventId: string, termsAccepted: boolean) =>
    http<ActivationResult>(
      `/api/organizer/events/${eventId}/activate-paid-sales`,
      { method: 'POST', ...json({ paid_event_terms_accepted: termsAccepted }) },
      token,
    ),

  activation: (token: string, eventId: string) =>
    http<ActivationStatus>(`/api/organizer/events/${eventId}/activation`, {}, token),

  campaigns: (token: string, eventId: string) =>
    http<{ campaigns: Campaign[] }>(`/api/organizer/campaigns/stats?event_id=${encodeURIComponent(eventId)}`, {}, token),
  createCampaign: (token: string, body: CampaignInput) =>
    http<{ qr_link?: string }>('/api/campaigns', { method: 'POST', ...json(body) }, token),
  setCampaignDisabled: (token: string, campaignId: string, disabled: boolean) =>
    http<unknown>(`/api/campaigns/${campaignId}/disabled`, { method: 'PATCH', ...json({ disabled }) }, token),

  history: (token: string, eventId: string) =>
    http<HistoryEntry[]>(`/api/organizer/events/${eventId}/history`, {}, token),
  duplicate: (token: string, eventId: string, body: { title?: string; starts_at?: string | null }) =>
    http<DuplicateResult>(`/api/organizer/events/${eventId}/duplicate`, { method: 'POST', ...json(body) }, token),
  attendees: (token: string, eventId: string, f: { status?: string; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(f.limit), offset: String(f.offset), ...(f.status ? { status: f.status } : {}) });
    return http<AttendeePage>(`/api/organizer/events/${eventId}/attendees?${q}`, {}, token);
  },
  refundOrder: (token: string, orderId: string, reason?: string) =>
    http<unknown>(`/api/organizer/orders/${orderId}/refund`, { method: 'POST', ...json(reason ? { reason } : {}) }, token),

  profile: (token: string) => http<Profile>('/api/users/me', {}, token),
  savePayout: (token: string, payoutInfo: string) =>
    http<Profile>('/api/users/me', { method: 'PUT', ...json({ payout_info: payoutInfo }) }, token),
};

/** `<input type="datetime-local">` ↔ ISO, in the event's wall time (Asia/Almaty, UTC+5 by default). */
export const toLocalInput = (iso: string | null, offsetHours = 5) =>
  iso ? new Date(new Date(iso).getTime() + offsetHours * 3600_000).toISOString().slice(0, 16) : '';
export const fromLocalInput = (v: string, offset = '+05:00') => (v ? `${v}:00${offset}` : null);
