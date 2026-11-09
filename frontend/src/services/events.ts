import { API_BASE_URL } from './config';

export interface TicketTier {
  id: string;
  name: string;
  description: string;
  priceKZT: number;
  remaining: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
}

export type EventStatus = 'draft' | 'published' | 'cancelled';

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
  status: EventStatus;
  visibility: 'public' | 'unlisted' | 'private';
  paidSalesActive: boolean;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
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
    status: r.status === 'draft' || r.status === 'cancelled' ? r.status : 'published',
    visibility: r.visibility === 'unlisted' || r.visibility === 'private' ? r.visibility : 'public',
    paidSalesActive: r.paid_sales_status === 'ACTIVE' && r.paid_sales_active !== false,
    registrationOpensAt: r.registration_opens_at ?? null,
    registrationClosesAt: r.registration_closes_at ?? null,
    ticketTiers: tiers.filter((t) => !t.is_hidden).map((t) => ({
      id: String(t.id),
      name: t.name ?? 'Standard',
      description: t.description ?? '',
      priceKZT: Number(t.price ?? t.price_kzt ?? 0),
      remaining: t.available ?? t.quantity ?? t.stock ?? null,
      saleStartsAt: t.sale_starts_at ?? null,
      saleEndsAt: t.sale_ends_at ?? null,
    })),
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
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
  if (!res.ok) throw new HttpError(errorMessage(data?.detail) ?? `Request failed (${res.status})`, res.status, data?.detail);
  return data as T;
}

// ---------- PB-8 public ----------
export async function getEvents(): Promise<EventItem[]> {
  const rows = await http<Raw[]>('/api/events');
  return rows.map(normalizeEvent).filter((e) => e.status === 'published');
}

/** With the organizer's token the owner can also open drafts (preview). */
export async function getEvent(id: string, token?: string | null): Promise<EventItem> {
  try {
    return normalizeEvent(await http<Raw>(`/api/events/${id}`, {}, token));
  } catch (e) {
    // an expired session should not hide public events
    if (token && e instanceof HttpError && e.status === 401) return getEvent(id);
    throw e;
  }
}

export const formatKZT = (n: number) =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} ₸`;
