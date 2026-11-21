import { http } from './events';

export const CATEGORIES = [
  'ticket_delivery', 'payment', 'refund', 'seating', 'event_information', 'check_in', 'account', 'technical',
] as const;
export type Category = (typeof CATEGORIES)[number];

// организатор пишет в поддержку платформы только по этим темам
export const ORGANIZER_PLATFORM_CATEGORIES: Category[] = ['account', 'payment', 'technical'];

export const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED'] as const;
export type CaseStatus = (typeof STATUSES)[number];

export const STATUS_BADGE: Record<CaseStatus, string> = {
  OPEN: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  WAITING_FOR_CUSTOMER: 'bg-purple-100 text-purple-800',
  RESOLVED: 'bg-gray-200 text-gray-700',
};


export interface SupportCase {
  id: string;
  requester_id: string;
  category: Category;
  status: CaseStatus;
  subject: string;
  event_id: string | null;
  order_id: string | null;
  ticket_id: string | null;
  assigned_to: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupportMessage {
  id: string;
  case_id: string;
  sender_id: string;
  body: string;
  created_at: string | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: { case_id?: string; [k: string]: unknown } | null;
  read: boolean;
  created_at: string;
}

export interface CaseContext {
  event_id?: string;
  order_id?: string;
  ticket_id?: string;
}

export const supportApi = {
  list: (token: string, f: { status?: string; category?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    q.set('page_size', '100');
    return http<{ cases: SupportCase[] }>(`/api/support/cases?${q}`, {}, token).then((r) => r.cases);
  },

  get: (token: string, id: string) =>
    http<{ case: SupportCase; messages: SupportMessage[] }>(`/api/support/cases/${id}`, {}, token),

  create: (token: string, body: { category: Category; subject: string; message: string } & CaseContext) =>
    http<{ case: SupportCase }>('/api/support/cases', { method: 'POST', body: JSON.stringify(body) }, token),

  reply: (token: string, id: string, body: string) =>
    http<{ message: SupportMessage }>(`/api/support/cases/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }, token),

  setStatus: (token: string, id: string, status: CaseStatus, assignToMe = false) =>
    http<{ case: SupportCase }>(
      `/api/support/cases/${id}/status`,
      { method: 'PATCH', body: JSON.stringify({ status, assign_to_me: assignToMe }) },
      token,
    ),

  escalate: (token: string, id: string, note: string) =>
    http<{ escalation_case: SupportCase }>(`/api/support/cases/${id}/escalate`, { method: 'POST', body: JSON.stringify({ note }) }, token),

  notifications: (token: string) => http<Notification[]>('/api/support/notifications', {}, token),
  markRead: (token: string, id: string) =>
    http<{ success: boolean }>(`/api/support/notifications/${id}/read`, { method: 'PATCH' }, token),
};
