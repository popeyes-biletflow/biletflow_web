import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT, HttpError } from '../services/events';
import { checkoutApi, formatEventDateTime, type MyOrder } from '../services/tickets';

// страница заказа — после оплаты переходим сюда, данные всегда с сервера
export function OrderPage() {
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const { token } = useAuth();
  const { t } = useTranslation();
  const [order, setOrder] = useState<MyOrder | null>(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    checkoutApi.order(token, orderId)
      .then((o) => {
        setOrder(o);
        setStatus('ok');
      })
      .catch((e) => {
        if (e instanceof HttpError && e.status === 404) {
          setStatus('missing');
        } else {
          setError(e.message);
          setStatus('error');
        }
      });
  }, [token, orderId]);

  if (status === 'loading') return <main className="mx-auto max-w-3xl p-6 text-gray-500">{t('common.loading')}</main>;

  if (!order) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">{status === 'missing' ? t('orderPage.notFound') : t('orders.loadError', { reason: error })}</h1>
        <Link to="/tickets" className="mt-4 inline-block text-blue-600">{t('ticket.backToOrders')}</Link>
      </main>
    );
  }

  const free = order.breakdown_kzt.total === 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {params.get('new') === '1' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">{free ? t('checkout.freeConfirmed') : t('checkout.paidConfirmed')}</p>
          <p className="mt-1 text-sm">{t('orderPage.ticketsIssued', { count: order.tickets.length })}</p>
        </div>
      )}

      <div>
        <Link to="/tickets" className="text-sm text-blue-600">{t('ticket.backToOrders')}</Link>
        <h1 className="mt-2 text-2xl font-extrabold">{t('orders.order')} #{order.id.slice(0, 8)}</h1>
        {order.created_at && <p className="text-sm text-gray-500">{formatEventDateTime(order.created_at, order.event.timezone)}</p>}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold"><Link to={'/events/' + order.event.id}>{order.event.title}</Link></h2>
        <p className="text-sm text-gray-600">{formatEventDateTime(order.event.starts_at, order.event.timezone)}</p>
        <p className="text-sm text-gray-600">{order.event.venue_name} {order.event.venue_address}</p>

        <div className="mt-4 space-y-1 text-sm">
          <p className="flex justify-between"><span className="text-gray-600">{order.ticket_type.name} × {order.quantity}</span><span>{formatKZT(order.breakdown_kzt.subtotal)}</span></p>
          {order.breakdown_kzt.discount > 0 && (
            <p className="flex justify-between text-emerald-700"><span>{t('orders.promo', { code: order.promo_code || '' })}</span><span>−{formatKZT(order.breakdown_kzt.discount)}</span></p>
          )}
          {order.breakdown_kzt.fee > 0 && <p className="flex justify-between"><span className="text-gray-600">{t('checkout.fee')}</span><span>{formatKZT(order.breakdown_kzt.fee)}</span></p>}
          <p className="flex justify-between border-t pt-2 font-bold"><span>{t('checkout.total')}</span><span>{formatKZT(order.breakdown_kzt.total)}</span></p>
        </div>
        <p className="mt-2 text-xs text-gray-500">{free ? t('checkout.noPaymentNeeded') : t('orders.paidSimulated')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t('orderPage.tickets')}</h2>
        {order.tickets.map((tk) => (
          <div key={tk.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <p className="font-mono text-xs text-gray-500">{tk.id}</p>
              <p className="font-medium">{tk.attendee_name || '—'} {tk.seat && <span className="text-gray-500">· {tk.seat}</span>}</p>
              <p className="text-xs text-gray-600">{t('orders.status.' + tk.status)}</p>
            </div>
            {tk.qr_payload && (
              <Link to={'/tickets/' + tk.id} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">{t('orders.openTicket')}</Link>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
