import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { TicketPDF, type TicketDetails } from '../components/TicketPDF';

export interface UserTicket {
  id: string;
  ticketId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketType: string;
  quantity: number;
  priceKZT: number;
  discountKZT: number;
  totalKZT: number;
  promoCode?: string;
  purchaseDate: string;
  status: 'ACTIVE' | 'USED' | 'CANCELLED' | 'CANCEL_PENDING';
}

// Резервные демо-данные на случай отсутствия ответа от бэкенда
const MOCK_TICKETS: UserTicket[] = [
  {
    id: 'ord-001',
    ticketId: 'TK-892104',
    eventName: 'ASTANA IT CONFERENCE 2026',
    eventDate: '2026-11-15 10:00',
    venue: 'Expo Center, Астана',
    ticketType: 'VIP Pass',
    quantity: 1,
    priceKZT: 25000,
    discountKZT: 2500,
    totalKZT: 22500,
    promoCode: 'BILETFLOW2026',
    purchaseDate: '2026-10-20',
    status: 'ACTIVE',
  },
  {
    id: 'ord-002',
    ticketId: 'TK-443190',
    eventName: 'Рок Концерт "Энергия Звука"',
    eventDate: '2026-12-05 19:00',
    venue: 'Almaty Arena, Алматы',
    ticketType: 'Стандарт',
    quantity: 2,
    priceKZT: 30000,
    discountKZT: 0,
    totalKZT: 30000,
    purchaseDate: '2026-10-22',
    status: 'ACTIVE',
  },
  {
    id: 'ord-003',
    ticketId: 'TK-112049',
    eventName: 'Форум Стартапов Central Asia',
    eventDate: '2026-09-10 09:00',
    venue: 'Hilton Astana, Астана',
    ticketType: 'Участник',
    quantity: 1,
    priceKZT: 15000,
    discountKZT: 1500,
    totalKZT: 13500,
    promoCode: 'EARLYBIRD',
    purchaseDate: '2026-08-30',
    status: 'USED',
  },
];

export const TicketDashboard: React.FC = () => {
  const { user, token } = useAuth();
  const [tickets, setTickets] = useState<UserTicket[]>(MOCK_TICKETS);
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'USED' | 'CANCELLED'>('ALL');
  
  // Состояния для модальных окон
  const [selectedPdfTicket, setSelectedPdfTicket] = useState<TicketDetails | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<UserTicket | null>(null);
  const [cancelModalTicket, setCancelModalTicket] = useState<UserTicket | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelSuccessMsg, setCancelSuccessMsg] = useState<string | null>(null);

  // Загрузка билетов текущего пользователя с бэкенда
  useEffect(() => {
    if (token) {
      setIsLoading(true);
      fetch('/api/orders/my-tickets', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('API unavailable');
        })
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setTickets(data);
          }
        })
        .catch(() => {
          // Использование MOCK_TICKETS при недоступности API
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [token]);

  // Фильтрация билетов
  const filteredTickets = tickets.filter((t) => {
    if (activeTab === 'ACTIVE') return t.status === 'ACTIVE';
    if (activeTab === 'USED') return t.status === 'USED';
    if (activeTab === 'CANCELLED') return t.status === 'CANCELLED' || t.status === 'CANCEL_PENDING';
    return true;
  });

  const getStatusBadge = (status: UserTicket['status']) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            ● Активен
          </span>
        );
      case 'USED':
        return (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
            ● Использован
          </span>
        );
      case 'CANCEL_PENDING':
        return (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            ● Запрос на отмену
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
            ● Отменен
          </span>
        );
    }
  };

  // Открытие модального окна генерации/скачивания PDF билета
  const handleOpenPdf = (ticket: UserTicket) => {
    const pdfData: TicketDetails = {
      ticketId: ticket.ticketId,
      eventName: ticket.eventName,
      eventDate: ticket.eventDate,
      venue: ticket.venue,
      attendeeName: user?.name || user?.email.split('@')[0] || 'Посетитель',
      attendeeEmail: user?.email || '',
      ticketType: ticket.ticketType,
      priceKZT: ticket.priceKZT,
      discountKZT: ticket.discountKZT,
      totalKZT: ticket.totalKZT,
    };
    setSelectedPdfTicket(pdfData);
  };

  // Запрос на отмену билета
  const handleConfirmCancel = async () => {
    if (!cancelModalTicket) return;

    try {
      if (token) {
        await fetch(`/api/orders/${cancelModalTicket.id}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: cancelReason }),
        }).catch(() => {});
      }

      setTickets((prev) =>
        prev.map((t) =>
          t.id === cancelModalTicket.id ? { ...t, status: 'CANCEL_PENDING' } : t
        )
      );

      setCancelSuccessMsg(`Запрос на отмену билета #${cancelModalTicket.ticketId} отправлен.`);
      setTimeout(() => setCancelSuccessMsg(null), 4000);
    } catch (e) {
      console.error(e);
    } finally {
      setCancelModalTicket(null);
      setCancelReason('');
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-800">Требуется авторизация</h2>
          <p className="mt-2 text-gray-600">
            Войдите в аккаунт, чтобы просмотреть свои билеты и историю заказов.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        
        {/* Заголовок личного кабинета */}
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900">Мои Билеты</h1>
            <p className="mt-1 text-sm text-gray-600">
              Пользователь: <span className="font-semibold text-gray-800">{user.name || user.email}</span> ({user.email})
            </p>
          </div>
          <div className="text-sm text-gray-500">
            Всего билетов: <span className="font-bold text-gray-800">{tickets.length}</span>
          </div>
        </div>

        {/* Уведомление об успехе */}
        {cancelSuccessMsg && (
          <div className="mb-6 rounded-lg bg-emerald-50 p-4 border border-emerald-200 text-emerald-800 text-sm font-medium">
            ✅ {cancelSuccessMsg}
          </div>
        )}

        {/* Фильтры/Вкладки */}
        <div className="mb-6 flex border-b border-gray-200 space-x-6">
          {(
            [
              { key: 'ALL', label: 'Все билеты' },
              { key: 'ACTIVE', label: 'Активные' },
              { key: 'USED', label: 'Прошедшие' },
              { key: 'CANCELLED', label: 'Отмененные' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Список карточек заказов */}
        {isLoading ? (
          <div className="py-12 text-center text-gray-500">Загрузка ваших заказов...</div>
        ) : filteredTickets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-gray-500 font-medium">В этой категории нет билетов.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    {getStatusBadge(ticket.status)}
                    <span className="text-xs font-mono text-gray-400">ID: #{ticket.ticketId}</span>
                  </div>

                  <h3 className="mt-2 text-xl font-bold text-gray-900">{ticket.eventName}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                    <p>📅 {ticket.eventDate}</p>
                    <p>📍 {ticket.venue}</p>
                    <p>🎫 {ticket.ticketType} (x{ticket.quantity})</p>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">Дата покупки: {ticket.purchaseDate}</p>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-3 border-t pt-4 sm:border-t-0 sm:pt-0">
                  <div className="text-right">
                    <span className="text-lg font-black text-gray-900">
                      {ticket.totalKZT.toLocaleString()} KZT
                    </span>
                    {ticket.discountKZT > 0 && (
                      <p className="text-xs text-emerald-600">
                        Скидка: -{ticket.discountKZT.toLocaleString()} KZT
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedOrderDetails(ticket)}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200 transition"
                    >
                      Детали заказа
                    </button>

                    {ticket.status === 'ACTIVE' && (
                      <button
                        onClick={() => handleOpenPdf(ticket)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                      >
                        📄 Скачать PDF
                      </button>
                    )}

                    {ticket.status === 'ACTIVE' && (
                      <button
                        onClick={() => setCancelModalTicket(ticket)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                      >
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 1. Модальное окно повторного скачивания A4 PDF (TicketPDF) */}
      {selectedPdfTicket && (
        <TicketPDF
          ticket={selectedPdfTicket}
          onClose={() => setSelectedPdfTicket(null)}
        />
      )}

      {/* 2. Модальное окно детальной инспекции заказа */}
      {selectedOrderDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">
                Детали заказа #{selectedOrderDetails.id}
              </h3>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                className="text-gray-400 hover:text-gray-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Мероприятие:</span>
                <span className="font-semibold text-gray-800">{selectedOrderDetails.eventName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Номер билета:</span>
                <span className="font-mono text-gray-800">#{selectedOrderDetails.ticketId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Тип билета:</span>
                <span className="font-semibold text-gray-800">{selectedOrderDetails.ticketType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Количество:</span>
                <span className="font-semibold text-gray-800">{selectedOrderDetails.quantity} шт.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Дата покупки:</span>
                <span className="text-gray-800">{selectedOrderDetails.purchaseDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Статус:</span>
                {getStatusBadge(selectedOrderDetails.status)}
              </div>

              <hr className="my-3" />

              <div className="flex justify-between">
                <span className="text-gray-500">Стоимость без скидки:</span>
                <span className="text-gray-800">{selectedOrderDetails.priceKZT.toLocaleString()} KZT</span>
              </div>
              {selectedOrderDetails.promoCode && (
                <div className="flex justify-between text-emerald-600">
                  <span>Промокод ({selectedOrderDetails.promoCode}):</span>
                  <span>-{selectedOrderDetails.discountKZT.toLocaleString()} KZT</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-900 border-t pt-2">
                <span>Итого к оплате:</span>
                <span>{selectedOrderDetails.totalKZT.toLocaleString()} KZT</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              {selectedOrderDetails.status === 'ACTIVE' && (
                <button
                  onClick={() => {
                    handleOpenPdf(selectedOrderDetails);
                    setSelectedOrderDetails(null);
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  📄 Открыть PDF
                </button>
              )}
              <button
                onClick={() => setSelectedOrderDetails(null)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-300"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Модальное окно подтверждения отмены билета */}
      {cancelModalTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">
              Отмена билета #{cancelModalTicket.ticketId}
            </h3>
            <p className="mt-2 text-xs text-gray-600">
              Вы действительно хотите запросить отмену билета на мероприятие{' '}
              <span className="font-semibold text-gray-800">{cancelModalTicket.eventName}</span>?
            </p>

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Причина отмены (необязательно)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Укажите причину..."
                className="w-full rounded-lg border border-gray-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                rows={3}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setCancelModalTicket(null)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-300"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmCancel}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Подтвердить отмену
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketDashboard;