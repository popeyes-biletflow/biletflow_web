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

/** FastAPI `detail` can be a string, a validation-error list, or an object (e.g. a checklist). */
function errorMessage(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : String(d))).join('; ');
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    const failed = Object.entries(d)
      .filter(([, v]) => v && typeof v === 'object' && (v as { passed?: boolean }).passed === false)
      .map(([k, v]) => `${k}${(v as { detail?: string }).detail ? `: ${(v as { detail?: string }).detail}` : ''}`);
    if (failed.length) return `Не выполнено: ${failed.join('; ')}`;
    return JSON.stringify(detail);
  }
  return String(detail);
}

export async function http<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
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
  if (!res.ok) throw new Error(errorMessage(data?.detail) ?? `Request failed (${res.status})`);
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
