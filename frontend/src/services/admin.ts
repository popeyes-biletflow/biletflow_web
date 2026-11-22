import { http } from './events';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_suspended: boolean;
  created_at: string | null;
}

export interface AdminEvent {
  id: string;
  title: string;
  organizer_id: string | null;
  status: string;
  visibility: string;
  paid_sales_status: 'NONE' | 'ACTIVE' | 'SUSPENDED' | string;
  paid_sales_active: boolean;
  is_suspended: boolean;
  created_at: string | null;
}

export interface AdminOrder {
  id: string;
  status: string;
  total_amount?: number | null;
  currency?: string | null;
  user_id?: string | null;
  event_id?: string | null;
  created_at?: string | null;
}

export interface AdminPayment {
  id: string;
  status: string;
  amount?: number | null;
  currency?: string | null;
  user_id?: string | null;
  event_id?: string | null;
  simulated?: boolean | null;
  created_at?: string | null;
}

export interface AdminCase {
  id: string;
  subject: string | null;
  category: string | null;
  status: string;
  requester_id?: string | null;
  event_id?: string | null;
  created_at?: string | null;
}

export interface SuspensionResult {
  success: boolean;
  suspended: boolean;
  message: string;
  entity_id: string;
  audit_recorded: boolean;
}

export interface OperationalExport {
  events_count: number;
  orders_count: number;
  tickets_count: number;
  total_revenue_kzt: number;
  timestamp: string;
  events: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

export const PAGE_SIZE = 50;

type Query = Record<string, string | number | undefined>;

const qs = (q: Query) => {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v !== undefined && v !== '') p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const adminApi = {
  users: (t: string, q: Query) => http<AdminUser[]>(`/api/admin/users${qs(q)}`, {}, t),
  events: (t: string, q: Query) => http<AdminEvent[]>(`/api/admin/events${qs(q)}`, {}, t),
  orders: (t: string, q: Query) => http<AdminOrder[]>(`/api/admin/orders${qs(q)}`, {}, t),
  payments: (t: string, q: Query) => http<AdminPayment[]>(`/api/admin/payments${qs(q)}`, {}, t),
  cases: (t: string, q: Query) => http<AdminCase[]>(`/api/admin/reports${qs(q)}`, {}, t),
  suspend: (t: string, kind: 'users' | 'events', id: string, reason: string) =>
    http<SuspensionResult>(`/api/admin/${kind}/${id}/suspend`, { method: 'POST', ...json({ reason }) }, t),
  unsuspend: (t: string, kind: 'users' | 'events', id: string) =>
    http<SuspensionResult>(`/api/admin/${kind}/${id}/unsuspend`, { method: 'POST' }, t),
  fee: (t: string) => http<{ activation_fee_kzt: number }>('/api/admin/settings/activation-fee', {}, t),
  setFee: (t: string, activation_fee_kzt: number) =>
    http<{ activation_fee_kzt: number }>('/api/admin/settings/activation-fee', { method: 'PATCH', ...json({ activation_fee_kzt }) }, t),
  exportAll: (t: string) => http<OperationalExport>('/api/admin/export', {}, t),
};
