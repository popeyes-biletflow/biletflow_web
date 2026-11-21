import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT } from '../services/events';
import { SupportDialog } from '../components/SupportDialog';
import { checkoutApi, formatEventDateTime, ticketsApi, type MyOrder, type MyOrderTicket, type TicketStatus } from '../services/tickets';

const BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  USED: 'bg-gray-200 text-gray-700',
  CANCEL_PENDING: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-purple-100 text-purple-800',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useTranslation();
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[status] || BADGE.CANCELLED}`}>{t('orders.status.' + status)}</span>;
}

const FILTERS = ['ALL', 'ACTIVE', 'USED', 'CANCELLED', 'REFUNDED'];

function matches(status: string, filter: string) {
  if (filter === 'ALL') return true;
  if (filter === 'CANCELLED') return status === 'CANCELLED' || status === 'CANCEL_PENDING';
  return status === filter;
}

// мои заказы: берём с /api/me/orders, сервер отдаёт только мои
export function TicketDashboard() {
  const { user, token } = useAuth();
  const { t } = useTranslation();

  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pdfBusy, setPdfBusy] = useState('');
  const [pdfError, setPdfError] = useState('');

  // отмена билета
  const [cancelTicket, setCancelTicket] = useState<MyOrderTicket | null>(null);
  const [cancelOrder, setCancelOrder] = useState<MyOrder | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');

  // обращение в поддержку по конкретному билету
  const [helpTicket, setHelpTicket] = useState('');
  const [helpLabel, setHelpLabel] = useState('');

  function load() {
    if (!token) return;
    setLoading(true);
    checkoutApi.orders(token)
      .then((data) => {
        setOrders(data);
        setLoadError('');
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function downloadPdf(ticketId: string) {
    if (!token) return;
    setPdfBusy(ticketId);
    setPdfError('');
    try {
      await ticketsApi.downloadPdf(token, ticketId);
    } catch (e) {
      setPdfError(t('ticket.pdfFailed', { reason: (e as Error).message }));
    }
    setPdfBusy('');
  }

  async function sendCancel() {
    if (!cancelTicket || !cancelOrder || !token) return;
    setSending(true);
    setCancelError('');
    try {
      await ticketsApi.requestCancel(token, { id: cancelTicket.id, event_title: cancelOrder.event.title }, reason);
      setSuccess(t('orders.cancelSent'));
      setTimeout(() => setSuccess(''), 4000);
      setCancelTicket(null);
      setReason('');
      load(); // статус «запрошена отмена» придёт с сервера
    } catch (e) {
      setCancelError((e as Error).message);
    }
    setSending(false);
  }

  let ticketCount = 0;
  orders.forEach((o) => (ticketCount += o.tickets.length));

  // фильтруем билеты внутри заказов, пустые заказы не показываем
  const visible = orders
    .map((o) => ({ ...o, tickets: o.tickets.filter((tk) => matches(tk.status, filter)) }))
    .filter((o) => o.tickets.length > 0);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-extrabold">{t('orders.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{user?.name || user?.email} · {t('orders.summary', { orders: orders.length, count: ticketCount })}</p>

        {success && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
        {pdfError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{pdfError}</p>}

        <div className="mb-6 mt-6 flex gap-6 overflow-x-auto border-b border-gray-200">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold ${filter === f ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
              {t('orders.filter.' + f)}
            </button>
          ))}
        </div>

        {loading && <p className="py-12 text-center text-gray-500">{t('common.loading')}</p>}

        {!loading && loadError && (
          <div className="rounded-xl bg-red-50 p-6 text-center text-sm text-red-700">
            {t('orders.loadError', { reason: loadError })}
            <button onClick={load} className="ml-3 underline">{t('common.retry')}</button>
          </div>
        )}

        {!loading && !loadError && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
            {orders.length === 0 ? t('orders.empty') : t('orders.emptyFilter')}
            {orders.length === 0 && <div><Link to="/events" className="text-blue-600">{t('orders.toEvents')}</Link></div>}
          </div>
        )}

        <div className="space-y-5">
          {visible.map((o) => (
            <div key={o.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold"><Link to={'/events/' + o.event.id}>{o.event.title}</Link></h2>
                  <p className="text-sm text-gray-600">{formatEventDateTime(o.event.starts_at, o.event.timezone)} · {o.event.venue_name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    <Link to={'/orders/' + o.id} className="font-mono hover:underline">{t('orders.order')} #{o.id.slice(0, 8)}</Link>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black">{o.breakdown_kzt.total > 0 ? formatKZT(o.breakdown_kzt.total) : t('common.free')}</p>
                  <p className="text-xs text-gray-500">{o.ticket_type.name} × {o.quantity}</p>
                  {o.breakdown_kzt.discount > 0 && (
                    <p className="text-xs text-emerald-700">{t('orders.promo', { code: o.promo_code || '' })} −{formatKZT(o.breakdown_kzt.discount)}</p>
                  )}
                  <p className="text-xs text-gray-500">{o.breakdown_kzt.total > 0 ? t('orders.paidSimulated') : t('orders.freeConfirmed')}</p>
                </div>
              </div>

              <ul className="mt-4 divide-y divide-gray-100 border-t">
                {o.tickets.map((tk) => (
                  <li key={tk.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <TicketStatusBadge status={tk.status} />
                        <span className="font-mono text-xs text-gray-400">#{tk.id.slice(0, 8)}</span>
                      </div>
                      <p className="mt-1 text-sm">{tk.attendee_name || user?.name} {tk.seat && <span className="text-gray-500">· {tk.seat}</span>}</p>
                      {tk.status === 'REFUNDED' && <p className="text-xs text-purple-800">{t('orders.refundedNote')}</p>}
                      {tk.status === 'CANCELLED' && <p className="text-xs text-red-700">{t('orders.cancelledNote')}</p>}
                      {tk.status === 'USED' && tk.checked_in_at && (
                        <p className="text-xs text-gray-500">{t('orders.checkedInAt', { date: formatEventDateTime(tk.checked_in_at, o.event.timezone) })}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link to={'/tickets/' + tk.id} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">{t('orders.viewTicket')}</Link>
                      <button onClick={() => downloadPdf(tk.id)} disabled={pdfBusy === tk.id}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                        {pdfBusy === tk.id ? t('common.loading') : t('ticket.downloadPdf')}
                      </button>
                      <button onClick={() => { setHelpTicket(tk.id); setHelpLabel(o.event.title + ' · #' + tk.id.slice(0, 8)); }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold">
                        {t('support.helpShort')}
                      </button>
                      {tk.status === 'ACTIVE' && (
                        <button onClick={() => { setCancelError(''); setCancelTicket(tk); setCancelOrder(o); }}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600">
                          {t('orders.requestCancel')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <SupportDialog open={helpTicket !== ''} onClose={() => setHelpTicket('')} context={{ ticket_id: helpTicket }}
        contextLabel={helpLabel} defaultCategory="ticket_delivery" />

      {cancelTicket && cancelOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">{t('orders.cancelTitle', { id: cancelTicket.id.slice(0, 8) })}</h2>
            <p className="mt-2 text-xs text-gray-600">{t('orders.cancelHint', { event: cancelOrder.event.title })}</p>
            <label htmlFor="cancel-reason" className="mt-4 block text-xs font-medium">{t('orders.cancelReason')}</label>
            <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
            {cancelError && <p className="mt-2 text-xs text-red-600">{cancelError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCancelTicket(null)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold">{t('common.back')}</button>
              <button onClick={sendCancel} disabled={sending} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {sending ? t('common.loading') : t('orders.sendCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default TicketDashboard;
