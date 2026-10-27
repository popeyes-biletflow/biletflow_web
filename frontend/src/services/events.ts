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
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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

export const formatKZT = (n: number) =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} ₸`;
