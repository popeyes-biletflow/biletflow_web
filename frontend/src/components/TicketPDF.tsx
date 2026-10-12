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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:p-0 print:static print:bg-white">
      <div className="flex flex-col items-center">
        <div className="mb-4 flex gap-3 print:hidden">
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-5 py-2 font-semibold text-white shadow hover:bg-emerald-700"
          >
            Печать / Сохранить в PDF (A4)
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-600 px-4 py-2 font-semibold text-white hover:bg-gray-700"
          >
            Закрыть
          </button>
        </div>

        <div className="w-[210mm] min-h-[297mm] bg-white p-10 text-gray-900 shadow-2xl print:shadow-none print:w-full print:min-h-0 print:p-0">
          <div className="border-4 border-dashed border-gray-300 p-8">
            <div className="flex justify-between items-center border-b pb-6 mb-6">
              <div>
                <h1 className="text-3xl font-extrabold text-blue-600">BILETFLOW</h1>
                <p className="text-sm text-gray-500">Официальный электронный билет</p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">
                  {ticket.ticketType}
                </span>
                <p className="mt-1 text-xs text-gray-500">ID: #{ticket.ticketId}</p>
              </div>
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-2">{ticket.eventName}</h2>
              <p className="text-gray-600">📅 Дата: {ticket.eventDate}</p>
              <p className="text-gray-600">📍 Место: {ticket.venue}</p>
            </div>

            <div className="grid grid-cols-2 gap-6 rounded-lg bg-gray-50 p-6 mb-8">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Посетитель</p>
                <p className="text-base font-bold text-gray-800">{ticket.attendeeName}</p>
                <p className="text-sm text-gray-600">{ticket.attendeeEmail}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Оплата</p>
                <p className="text-base font-bold text-gray-800">{ticket.totalKZT.toLocaleString()} KZT</p>
                {ticket.discountKZT > 0 && (
                  <p className="text-xs text-emerald-600">
                    Скидка: {ticket.discountKZT.toLocaleString()} KZT
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center border-t pt-8 mt-12">
              <div>
                <div className="h-16 w-48 bg-gray-200 flex items-center justify-center font-mono text-xs tracking-widest text-gray-500">
                  ||||| ||| |||| ||||| ||
                </div>
                <p className="mt-1 text-center font-mono text-xs text-gray-400">
                  {ticket.ticketId}-VALID
                </p>
              </div>
              <div className="text-right text-xs text-gray-400 max-w-xs">
                Пожалуйста, предъявите этот билет при входе.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};