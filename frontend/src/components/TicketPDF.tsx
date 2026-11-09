import React from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';

export interface TicketDetails {
  ticketId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  venueAddress?: string;
  attendeeName: string;
  ticketType: string;
  /** Assigned seat, when the event uses assigned seating (SRS 4.7). */
  seat?: string | null;
  /** Signed payload from the backend: ticket_id:event_id:user_id:expires_at:hmac */
  qrPayload: string | null;
  status?: string;
}

interface Props {
  ticket: TicketDetails;
  onClose: () => void;
}

/**
 * Print-optimised A4 ticket (SRS 4.7 / UC7).
 * Only admission data is printed: no email, payment or card details.
 * The QR is pure black on white with a quiet zone so it scans from a grayscale print.
 * Rendered in a portal so `@media print` can hide the rest of the app (see index.css).
 */
export const TicketPDF: React.FC<Props> = ({ ticket, onClose }) => {
  return createPortal(
    <div className="ticket-print-root fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center sm:p-6 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="relative my-auto flex w-full max-w-2xl flex-col items-center print:w-full print:max-w-none">
        <div className="sticky top-2 z-10 mb-4 flex gap-3 rounded-xl bg-gray-900/80 p-2.5 shadow-lg backdrop-blur-md print:hidden">
          <button
            onClick={() => window.print()}
            disabled={!ticket.qrPayload}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-700 disabled:opacity-50"
          >
            Печать / Сохранить в PDF (A4)
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Закрыть
          </button>
        </div>

        <div className="w-full rounded-2xl bg-white p-6 text-gray-900 shadow-2xl sm:p-8 print:min-h-0 print:w-[190mm] print:rounded-none print:p-0 print:shadow-none">
          <div className="border-4 border-dashed border-gray-300 p-6 sm:p-8 print:border-gray-500">
            <div className="mb-6 flex items-center justify-between border-b pb-6">
              <div>
                <h1 className="text-2xl font-extrabold text-blue-600 sm:text-3xl print:text-black">BILETFLOW</h1>
                <p className="text-xs text-gray-500 sm:text-sm">Электронный билет</p>
              </div>
              <span className="inline-block rounded bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 sm:text-sm print:border print:border-black print:bg-white print:text-black">
                {ticket.ticketType}
              </span>
            </div>

            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between print:flex-row">
              <div className="min-w-0 flex-1 space-y-4">
                <h2 className="text-xl font-bold sm:text-2xl">{ticket.eventName}</h2>
                <dl className="space-y-3 text-sm sm:text-base">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-gray-500">Дата и время</dt>
                    <dd className="font-medium">{ticket.eventDate}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-gray-500">Место</dt>
                    <dd className="font-medium">{ticket.venue}</dd>
                    {ticket.venueAddress && <dd className="text-gray-600">{ticket.venueAddress}</dd>}
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-gray-500">Посетитель</dt>
                    <dd className="font-medium">{ticket.attendeeName}</dd>
                  </div>
                  {ticket.seat && (
                    <div>
                      <dt className="text-xs font-semibold uppercase text-gray-500">Место в зале</dt>
                      <dd className="font-medium">{ticket.seat}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="flex flex-col items-center">
                {ticket.qrPayload ? (
                  <div className="bg-white p-2">
                    <QRCodeSVG
                      value={ticket.qrPayload}
                      size={208}
                      level="M"
                      marginSize={4}
                      bgColor="#FFFFFF"
                      fgColor="#000000"
                      title={`QR-код билета ${ticket.ticketId}`}
                    />
                  </div>
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center rounded border-2 border-gray-300 p-4 text-center text-sm text-gray-500">
                    Билет недействителен — QR-код не выдаётся
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 border-t pt-4 text-xs text-gray-500">
              <p className="break-all font-mono">ID билета: {ticket.ticketId}</p>
              <p className="mt-1">
                Предъявите QR-код при входе. Электронная и печатная копии — один и тот же билет: пройти по нему можно один раз.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
