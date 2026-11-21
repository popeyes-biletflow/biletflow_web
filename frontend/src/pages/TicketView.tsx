import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { TicketPDF } from '../components/TicketPDF';
import { HttpError } from '../services/events';
import { formatEventDateTime, ticketsApi, type MyTicket } from '../services/tickets';

// билет на экране — тот же билет и тот же QR, что в PDF
export function TicketView() {
  const { ticketId = '' } = useParams();
  const { token } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) return;
    ticketsApi.one(token, ticketId)
      .then((tk) => {
        setTicket(tk);
        setStatus('ok');
      })
      .catch((e) => {
        // чужой билет по ссылке — просто «не найден»
        if (e instanceof HttpError && e.status === 404) {
          setStatus('missing');
        } else {
          setError(e.message);
          setStatus('error');
        }
      });
  }, [token, ticketId]);

  async function download() {
    if (!token || !ticket) return;
    setDownloading(true);
    try {
      await ticketsApi.downloadPdf(token, ticket.id);
    } catch (e) {
      setError(t('ticket.pdfFailed', { reason: (e as Error).message }));
    }
    setDownloading(false);
  }

  if (status === 'loading') return <main className="mx-auto max-w-4xl p-6 text-gray-500">{t('common.loading')}</main>;

  if (!ticket) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-bold">{status === 'error' ? t('orders.loadError', { reason: error }) : t('ticket.notFound')}</h1>
        <Link to="/tickets" className="mt-4 inline-block text-blue-600">{t('ticket.backToOrders')}</Link>
      </main>
    );
  }

  return (
    <>
      {error && <p role="alert" className="mx-auto max-w-2xl p-4 text-sm text-red-700">{error}</p>}
      <TicketPDF
        ticket={{
          ticketId: ticket.id,
          eventName: ticket.event_title,
          eventDate: formatEventDateTime(ticket.starts_at, ticket.timezone),
          venue: ticket.venue_name,
          venueAddress: ticket.venue_address,
          attendeeName: ticket.attendee_name,
          ticketType: ticket.ticket_type,
          seat: ticket.seat,
          qrPayload: ticket.qr_payload,
          status: ticket.status,
        }}
        onDownload={download}
        downloading={downloading}
        onClose={() => navigate('/tickets')}
      />
    </>
  );
}
