import { API_BASE_URL } from './config';

export interface TicketTier {
  id: string;
  name: string;
  priceKZT: number;
  remaining: number | null;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  category: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
  imageUrl: string | null;
  status: 'draft' | 'published';
  ticketTiers: TicketTier[];
}

type Raw = Record<string, any>;

// The Supabase `events` table has evolved over sprints; accept old and new column names.
export function normalizeEvent(r: Raw): EventItem {
  const tiers: Raw[] = r.ticket_types ?? r.ticket_tiers ?? [];
  return {
    id: String(r.id),
    title: r.title ?? r.name ?? 'Untitled event',
    description: r.description ?? '',
    category: r.category ?? 'Other',
    startsAt: r.starts_at ?? r.start_time ?? r.date ?? r.event_date ?? new Date().toISOString(),
    endsAt: r.ends_at ?? r.end_time ?? null,
    timezone: r.timezone ?? 'Asia/Almaty',
    venueName: r.venue_name ?? r.venue ?? r.location ?? '',
    venueAddress: r.venue_address ?? r.address ?? '',
    imageUrl: r.image_url ?? null,
    status: r.status === 'draft' ? 'draft' : 'published',
    ticketTiers: tiers.map((t) => ({
      id: String(t.id),
      name: t.name ?? 'Standard',
      priceKZT: Number(t.price ?? t.price_kzt ?? 0),
      remaining: t.quantity ?? t.stock ?? null,
    })),
  };
}

async function http<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail ?? `Request failed (${res.status})`);
  return data as T;
}

// ---------- PB-8 public ----------
export async function getEvents(): Promise<EventItem[]> {
  const rows = await http<Raw[]>('/api/events');
  return rows.map(normalizeEvent).filter((e) => e.status === 'published');
}

export async function getEvent(id: string): Promise<EventItem> {
  return normalizeEvent(await http<Raw>(`/api/events/${id}`));
}

// ---------- PB-13 organizer ----------
export interface EventForm {
  title: string;
  description: string;
  category: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  venue_name: string;
  venue_address: string;
  image_url: string;
}

export interface EventStats {
  registrations: number;
  tickets_sold: number;
  checked_in: number;
  cancelled: number;
  gross_revenue_kzt: number;
  by_ticket_type: { ticket_type_id: string; name: string; price_kzt: number; sold: number; remaining: number | null }[];
}

export interface CampaignStats {
  campaigns: { code?: string; name?: string; uses?: number; orders?: number; discount_kzt?: number; revenue_kzt?: number; [k: string]: unknown }[];
  totals: Record<string, number>;
}

export const organizerApi = {
  list: async (token: string) => (await http<Raw[]>('/api/organizer/events', {}, token)).map(normalizeEvent),
  create: (token: string, body: Partial<EventForm>) =>
    http<Raw>('/api/organizer/events', { method: 'POST', body: JSON.stringify(body) }, token),
  update: (token: string, id: string, body: Partial<EventForm>) =>
    http<Raw>(`/api/organizer/events/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
  publish: (token: string, id: string, published: boolean) =>
    http<Raw>(`/api/organizer/events/${id}/publish?published=${published}`, { method: 'PATCH' }, token),
  remove: (token: string, id: string) => http<void>(`/api/organizer/events/${id}`, { method: 'DELETE' }, token),
  stats: (token: string, id: string) => http<EventStats>(`/api/organizer/events/${id}/stats`, {}, token),
  // Provided by PB-12 (PR #8). Dashboard degrades gracefully if it is not merged yet.
  campaigns: (token: string) => http<CampaignStats>('/api/organizer/campaigns/stats', {}, token),
};

export const formatKZT = (n: number) =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} ₸`;
