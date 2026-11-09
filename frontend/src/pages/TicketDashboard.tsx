import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { TicketPDF, type TicketDetails } from '../components/TicketPDF';
import { formatKZT } from '../services/events';
import { formatEventDateTime, ticketsApi, type MyTicket } from '../services/tickets';

export function TicketDashboard() {
  const { user, token } = useAuth();

  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [tab, setTab] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // модалки
  const [pdfTicket, setPdfTicket] = useState<TicketDetails | null>(null);
  const [orderTicket, setOrderTicket] = useState<MyTicket | null>(null);
  const [cancelTicket, setCancelTicket] = useState<MyTicket | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [success, setSuccess] = useState('');

  function loadTickets() {
    if (!token) return;
    setLoading(true);
    ticketsApi
      .mine(token)
      .then((data) => {
        setTickets(data);
        setLoadError('');
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTickets();
  }, [token]);

  const filtered = tickets.filter((t) => {
    if (tab === 'ACTIVE') return t.status === 'ACTIVE';
    if (tab === 'USED') return t.status === 'USED';
    if (tab === 'CANCELLED') return t.status === 'CANCELLED' || t.status === 'CANCEL_PENDING';
    return true;
  });

  function badge(status: string) {
    if (status === 'ACTIVE') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Активен</span>;
    if (status === 'USED') return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">Использован</span>;
    if (status === 'CANCEL_PENDING') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Запрос на отмену</span>;
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Отменён</span>;
  }

  function openPdf(t: MyTicket) {
    setPdfTicket({
      ticketId: t.id,
      eventName: t.event_title,
      eventDate: formatEventDateTime(t.starts_at, t.timezone),
      venue: t.venue_name,
      venueAddress: t.venue_address,
      attendeeName: user?.name || user?.email || '',
      ticketType: t.ticket_type,
      qrPayload: t.qr_payload,
    });
  }

  async function sendCancel() {
    if (!cancelTicket || !token) return;
    try {
      await ticketsApi.requestCancel(token, cancelTicket, reason);
      setSuccess('Запрос на отмену отправлен организатору');
      setTimeout(() => setSuccess(''), 4000);
      setCancelTicket(null);
      setReason('');
      loadTickets(); // перезагружаем, статус придёт с сервера
    } catch (e) {
      setCancelError((e as Error).message);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold">Требуется авторизация</h2>
        <p className="mt-2 text-gray-600">Войдите, чтобы увидеть свои билеты.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-extrabold">Мои билеты</h1>
        <p className="mt-1 text-sm text-gray-600">
          {user.name || user.email} · всего билетов: {tickets.length}
        </p>

        {success && <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}

        <div className="mb-6 mt-6 flex gap-6 border-b border-gray-200">
          {[
            ['ALL', 'Все'],
            ['ACTIVE', 'Активные'],
            ['USED', 'Использованные'],
            ['CANCELLED', 'Отменённые'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 text-sm font-semibold border-b-2 ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <p className="py-12 text-center text-gray-500">Загрузка...</p>}

        {!loading && loadError && (
          <div className="rounded-xl bg-red-50 p-6 text-center text-sm text-red-700">
            Не удалось загрузить билеты: {loadError}
            <button onClick={loadTickets} className="ml-3 underline">Повторить</button>
          </div>
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
            {tickets.length === 0 ? 'У вас пока нет билетов.' : 'В этой категории ничего нет.'}
            {tickets.length === 0 && (
              <div><Link to="/events" className="text-blue-600">Перейти в афишу</Link></div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {filtered.map((t) => (
            <div key={t.id} className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  {badge(t.status)}
                  <span className="font-mono text-xs text-gray-400">#{t.id.slice(0, 8)}</span>
                </div>
                <h3 className="mt-2 text-xl font-bold">
                  <Link to={`/events/${t.event_id}`}>{t.event_title}</Link>
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  {formatEventDateTime(t.starts_at, t.timezone)} · {t.venue_name} · {t.ticket_type}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:items-end">
                <div className="text-lg font-black">{t.total_kzt > 0 ? formatKZT(t.total_kzt) : 'Бесплатно'}</div>
                {t.discount_kzt > 0 && <div className="text-xs text-emerald-700">Скидка: −{formatKZT(t.discount_kzt)}</div>}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setOrderTicket(t)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold hover:bg-gray-200">
                    Детали заказа
                  </button>
                  {t.qr_payload && (
                    <button onClick={() => openPdf(t)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                      Билет / PDF
                    </button>
                  )}
                  {t.status === 'ACTIVE' && (
                    <button
                      onClick={() => { setCancelError(''); setCancelTicket(t); }}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Отменить
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {pdfTicket && <TicketPDF ticket={pdfTicket} onClose={() => setPdfTicket(null)} />}

      {/* детали заказа */}
      {orderTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex justify-between border-b pb-3">
              <h3 className="text-lg font-bold">Заказ #{(orderTicket.order_id || orderTicket.id).slice(0, 8)}</h3>
              <button onClick={() => setOrderTicket(null)}>✕</button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <p><span className="text-gray-500">Мероприятие:</span> {orderTicket.event_title}</p>
              <p><span className="text-gray-500">Дата:</span> {formatEventDateTime(orderTicket.starts_at, orderTicket.timezone)}</p>
              <p><span className="text-gray-500">Место:</span> {orderTicket.venue_name} {orderTicket.venue_address}</p>
              <p><span className="text-gray-500">Тип билета:</span> {orderTicket.ticket_type}</p>
              <p className="break-all"><span className="text-gray-500">ID билета:</span> {orderTicket.id}</p>
              <p><span className="text-gray-500">Статус:</span> {badge(orderTicket.status)}</p>

              <hr className="my-3" />

              <p className="flex justify-between"><span>Стоимость билета</span><span>{formatKZT(orderTicket.subtotal_kzt)}</span></p>
              {orderTicket.discount_kzt > 0 && (
                <p className="flex justify-between text-emerald-700">
                  <span>Промокод {orderTicket.promo_code}</span>
                  <span>−{formatKZT(orderTicket.discount_kzt)}</span>
                </p>
              )}
              {orderTicket.fee_kzt > 0 && (
                <p className="flex justify-between"><span>Сервисный сбор</span><span>{formatKZT(orderTicket.fee_kzt)}</span></p>
              )}
              <p className="flex justify-between border-t pt-2 text-base font-bold">
                <span>Итого</span><span>{formatKZT(orderTicket.total_kzt)}</span>
              </p>
              {orderTicket.total_kzt > 0 && <p className="text-xs text-gray-500">Оплата демонстрационная, деньги не списывались.</p>}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              {orderTicket.qr_payload && (
                <button
                  onClick={() => { openPdf(orderTicket); setOrderTicket(null); }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
                >
                  Открыть билет
                </button>
              )}
              <button onClick={() => setOrderTicket(null)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* отмена */}
      {cancelTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold">Отмена билета #{cancelTicket.id.slice(0, 8)}</h3>
            <p className="mt-2 text-xs text-gray-600">
              Запрос уйдёт организатору «{cancelTicket.event_title}» как обращение в поддержку.
              Пока он не подтвердит, билет остаётся действительным.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Причина отмены"
              className="mt-4 w-full rounded-lg border border-gray-300 p-2 text-xs"
            />
            {cancelError && <p className="mt-2 text-xs text-red-600">{cancelError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCancelTicket(null)} className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold">Назад</button>
              <button onClick={sendCancel} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white">Отправить запрос</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TicketDashboard;
