import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT } from '../services/events';
import { formatEventDateTime, ticketsApi, type MyTicket, type TicketStatus } from '../services/tickets';
import { formatEventDate } from '../i18n';

const BADGE: Record<TicketStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  USED: 'bg-gray-200 text-gray-700',
  CANCEL_PENDING: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-purple-100 text-purple-800',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[status] ?? BADGE.CANCELLED}`}>
      {t(`orders.status.${status}`)}
    </span>
  );
}

type Filter = 'ALL' | 'ACTIVE' | 'USED' | 'CANCELLED' | 'REFUNDED';
const FILTERS: Filter[] = ['ALL', 'ACTIVE', 'USED', 'CANCELLED', 'REFUNDED'];

interface Order {
  id: string;
  eventTitle: string;
  eventId: string;
  purchasedAt: string | null;
  timezone: string;
  total: number;
  discount: number;
  fee: number;
  subtotal: number;
  promo: string | null;
  tickets: MyTicket[];
}

function groupOrders(tickets: MyTicket[]): Order[] {
  const map = new Map<string, Order>();
  for (const tk of tickets) {
    const key = tk.order_id || tk.id;
    let o = map.get(key);
    if (!o) {
      o = {
        id: key, eventTitle: tk.event_title, eventId: tk.event_id, purchasedAt: tk.purchased_at,
        timezone: tk.timezone, total: 0, discount: 0, fee: 0, subtotal: 0, promo: tk.promo_code, tickets: [],
      };
      map.set(key, o);
    }
    o.total += tk.total_kzt;
    o.discount += tk.discount_kzt;
    o.fee += tk.fee_kzt;
    o.subtotal += tk.subtotal_kzt;
    o.tickets.push(tk);
  }
  return [...map.values()].sort((a, b) => (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? ''));
}

export function TicketDashboard() {
  const { user, token } = useAuth();
  const { t } = useTranslation();

  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [view, setView] = useState<'orders' | 'tickets'>('orders');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [cancelTicket, setCancelTicket] = useState<MyTicket | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');

  function loadTickets() {
    if (!token) return;
    setLoading(true);
    ticketsApi
      .mine(token)
      .then((data) => { setTickets(data); setLoadError(''); })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTickets(); }, [token]);

  const orders = useMemo(() => groupOrders(tickets), [tickets]);
  const filtered = tickets.filter((tk) => {
    if (filter === 'ALL') return true;
    if (filter === 'CANCELLED') return tk.status === 'CANCELLED' || tk.status === 'CANCEL_PENDING';
    return tk.status === filter;
  });

  async function sendCancel() {
    if (!cancelTicket || !token) return;
    setSending(true);
    setCancelError('');
    try {
      await ticketsApi.requestCancel(token, cancelTicket, reason);
      setSuccess(t('orders.cancelSent'));
      setTimeout(() => setSuccess(''), 4000);
      setCancelTicket(null);
      setReason('');
      loadTickets();
    } catch (e) {
      setCancelError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!user) return null;

  const ticketActions = (tk: MyTicket) => (
    <div className="flex flex-wrap gap-2">
      {tk.qr_payload ? (
        <Link to={`/tickets/${tk.id}`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
          {t('orders.openTicket')}
        </Link>
      ) : (
        <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500">{t('orders.noQr')}</span>
      )}
      {tk.status === 'ACTIVE' && (
        <button
          onClick={() => { setCancelError(''); setCancelTicket(tk); }}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
        >
          {t('orders.requestCancel')}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-extrabold">{t('orders.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {user.name || user.email} · {t('orders.summary', { orders: orders.length, count: tickets.length })}
        </p>

        {success && <div role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

        <div className="mt-6 inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {(['orders', 'tickets'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold ${view === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {t(`orders.view.${v}`)}
            </button>
          ))}
        </div>

        {view === 'tickets' && (
          <div className="mb-2 mt-4 flex flex-wrap gap-4 border-b border-gray-200">
            {FILTERS.map((key) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`border-b-2 pb-3 text-sm font-semibold ${filter === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
                {t(`orders.filter.${key}`)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          {loading && <p className="py-12 text-center text-gray-500">{t('common.loading')}</p>}

          {!loading && loadError && (
            <div role="alert" className="rounded-xl bg-red-50 p-6 text-center text-sm text-red-700">
              {t('orders.loadError', { reason: loadError })}
              <button onClick={loadTickets} className="ml-3 underline">{t('common.retry')}</button>
            </div>
          )}

          {!loading && !loadError && tickets.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
              {t('orders.empty')}
              <div><Link to="/events" className="text-blue-600">{t('orders.toEvents')}</Link></div>
            </div>
          )}

          {!loading && !loadError && view === 'orders' && (
            <div className="space-y-4">
              {orders.map((o) => (
                <article key={o.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-gray-400">{t('orders.order')} #{o.id.slice(0, 8)}
                        {o.purchasedAt && <> · {formatEventDate(o.purchasedAt, o.timezone, 'card')}</>}
                      </p>
                      <h3 className="mt-1 text-xl font-bold"><Link to={`/events/${o.eventId}`}>{o.eventTitle}</Link></h3>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black">{formatKZT(o.total)}</div>
                      {o.total === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{t('orders.freeConfirmed')}</span>
                      ) : (
                        <span className="text-xs text-gray-500">{t('orders.paidSimulated')}</span>
                      )}
                    </div>
                  </div>

                  <dl className="mt-3 space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between text-gray-600"><dt>{t('checkout.subtotal')}</dt><dd>{formatKZT(o.subtotal)}</dd></div>
                    {o.discount > 0 && (
                      <div className="flex justify-between text-emerald-700"><dt>{t('orders.promo', { code: o.promo ?? '' })}</dt><dd>−{formatKZT(o.discount)}</dd></div>
                    )}
                    {o.fee > 0 && <div className="flex justify-between text-gray-600"><dt>{t('checkout.fee')}</dt><dd>{formatKZT(o.fee)}</dd></div>}
                  </dl>

                  <ul className="mt-3 divide-y divide-gray-100">
                    {o.tickets.map((tk) => (
                      <li key={tk.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="text-sm">
                          <div className="flex items-center gap-2">
                            <TicketStatusBadge status={tk.status} />
                            <span className="font-medium">{tk.ticket_type}</span>
                          </div>
                          <p className="mt-1 text-gray-600">{formatEventDateTime(tk.starts_at, tk.timezone)} · {tk.venue_name}</p>
                        </div>
                        {ticketActions(tk)}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}

          {!loading && !loadError && view === 'tickets' && tickets.length > 0 && (
            <div className="space-y-4">
              {filtered.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">{t('orders.emptyFilter')}</div>
              )}
              {filtered.map((tk) => (
                <div key={tk.id} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <TicketStatusBadge status={tk.status} />
                      <span className="font-mono text-xs text-gray-400">#{tk.id.slice(0, 8)}</span>
                    </div>
                    <h3 className="mt-2 text-xl font-bold"><Link to={`/events/${tk.event_id}`}>{tk.event_title}</Link></h3>
                    <p className="mt-1 text-sm text-gray-600">
                      {formatEventDateTime(tk.starts_at, tk.timezone)} · {tk.venue_name} · {tk.ticket_type}
                    </p>
                    {tk.checked_in_at && (
                      <p className="mt-1 text-xs text-gray-500">{t('orders.checkedInAt', { date: formatEventDate(tk.checked_in_at, tk.timezone, 'card') })}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    <div className="text-lg font-black">{tk.total_kzt > 0 ? formatKZT(tk.total_kzt) : t('common.free')}</div>
                    {ticketActions(tk)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {cancelTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold">{t('orders.cancelTitle', { id: cancelTicket.id.slice(0, 8) })}</h3>
            <p className="mt-2 text-xs text-gray-600">{t('orders.cancelHint', { event: cancelTicket.event_title })}</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t('orders.cancelReason')}
              className="mt-4 w-full rounded-lg border border-gray-300 p-2 text-xs"
            />
            {cancelError && <p role="alert" className="mt-2 text-xs text-red-600">{cancelError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCancelTicket(null)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold">{t('common.back')}</button>
              <button onClick={sendCancel} disabled={sending} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {sending ? t('common.saving') : t('orders.sendCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TicketDashboard;
