import React from 'react';

export interface TicketDetails {
  ticketId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  attendeeName: string;
  attendeeEmail: string;
  ticketType: string;
  priceKZT: number;
  discountKZT: number;
  totalKZT: number;
}

interface Props {
  ticket: TicketDetails;
  onClose: () => void;
}

export const TicketPDF: React.FC<Props> = ({ ticket, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 p-4 sm:p-6 print:p-0 print:static print:bg-white print:overflow-visible">
      <div className="relative my-auto flex flex-col items-center w-full max-w-2xl print:w-full print:max-w-none">
        
        {/* Фиксированная панель кнопок: всегда сверху и видна на экране */}
        <div className="sticky top-2 z-10 mb-4 flex gap-3 rounded-xl bg-gray-900/80 p-2.5 shadow-lg backdrop-blur-md print:hidden">
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 transition"
          >
            🖨️ Печать / Сохранить в PDF (A4)
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition"
          >
            Закрыть
          </button>
        </div>

        {/* Адаптивный вид билета для экрана / Точный размер A4 для печати */}
        <div className="w-full bg-white p-6 sm:p-8 text-gray-900 shadow-2xl rounded-2xl print:rounded-none print:shadow-none print:w-[210mm] print:min-h-[297mm] print:p-10">
          <div className="border-4 border-dashed border-gray-300 p-6 sm:p-8">
            <div className="flex justify-between items-center border-b pb-6 mb-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-blue-600">BILETFLOW</h1>
                <p className="text-xs sm:text-sm text-gray-500">Официальный электронный билет</p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded bg-blue-100 px-3 py-1 text-xs sm:text-sm font-bold text-blue-800">
                  {ticket.ticketType}
                </span>
                <p className="mt-1 text-xs text-gray-500">ID: #{ticket.ticketId}</p>
              </div>
            </div>

            <div className="mb-6 sm:mb-8">
              <h2 className="text-xl sm:text-2xl font-bold mb-2">{ticket.eventName}</h2>
              <p className="text-sm sm:text-base text-gray-600">📅 Дата: {ticket.eventDate}</p>
              <p className="text-sm sm:text-base text-gray-600">📍 Место: {ticket.venue}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-6 rounded-lg bg-gray-50 p-4 sm:p-6 mb-6 sm:mb-8">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Посетитель</p>
                <p className="text-sm sm:text-base font-bold text-gray-800">{ticket.attendeeName}</p>
                <p className="text-xs sm:text-sm text-gray-600 break-all">{ticket.attendeeEmail}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Оплата</p>
                <p className="text-sm sm:text-base font-bold text-gray-800">{ticket.totalKZT.toLocaleString()} KZT</p>
                {ticket.discountKZT > 0 && (
                  <p className="text-xs text-emerald-600">
                    Скидка: {ticket.discountKZT.toLocaleString()} KZT
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center border-t pt-6 sm:pt-8 mt-8 gap-4">
              <div>
                <div className="h-14 w-44 sm:h-16 sm:w-48 bg-gray-200 flex items-center justify-center font-mono text-xs tracking-widest text-gray-500">
                  ||||| ||| |||| ||||| ||
                </div>
                <p className="mt-1 text-center font-mono text-xs text-gray-400">
                  {ticket.ticketId}-VALID
                </p>
              </div>
              <div className="text-center sm:text-right text-xs text-gray-400 max-w-xs">
                Пожалуйста, предъявите этот билет при входе.
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};