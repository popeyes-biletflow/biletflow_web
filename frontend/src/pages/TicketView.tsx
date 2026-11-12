import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { TicketPDF } from '../components/TicketPDF';
import { formatEventDateTime, ticketsApi, type MyTicket } from '../services/tickets';

/** Printable ticket for one of the signed-in user's tickets. Other users' ticket ids are just "not found". */
export function TicketView() {
  const { ticketId = '' } = useParams();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    ticketsApi
      .mine(token)
      .then((list) => {
        const found = list.find((x) => x.id === ticketId) ?? null;
        setTicket(found);
        setState(found ? 'ok' : 'missing');
      })
      .catch((e: Error) => { setError(e.message); setState('error'); });
  }, [token, ticketId]);

  if (state === 'loading') return <main className="mx-auto max-w-4xl p-6 text-gray-500">{t('common.loading')}</main>;
  if (state !== 'ok' || !ticket) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h2 role="alert" className="text-2xl font-bold">
          {state === 'error' ? t('orders.loadError', { reason: error }) : t('ticket.notFound')}
        </h2>
        <Link to="/tickets" className="mt-4 inline-block text-blue-600">{t('ticket.backToOrders')}</Link>
      </main>
    );
  }

  return (
    <TicketPDF
      ticket={{
        ticketId: ticket.id,
        eventName: ticket.event_title,
        eventDate: formatEventDateTime(ticket.starts_at, ticket.timezone),
        venue: ticket.venue_name,
        venueAddress: ticket.venue_address,
        attendeeName: user?.name || user?.email || '',
        ticketType: ticket.ticket_type,
        qrPayload: ticket.qr_payload,
        status: ticket.status,
      }}
      onClose={() => navigate('/tickets')}
    />
  );
}
