import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getEvent, formatKZT, type EventItem } from '../services/events';
import { downloadIcs } from '../services/calendar';
import { formatEventDate, categoryKey } from '../i18n';
import { VenueMap } from '../components/VenueMap';
import { SeatingLayout } from '../components/SeatingLayout';

export function EventDetailsPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    getEvent(id).then((e) => { setEvent(e); setState('ok'); }).catch(() => setState('missing'));
  }, [id]);

  if (state === 'loading') return <main className="mx-auto max-w-4xl p-6 text-gray-500">{t('details.loading')}</main>;
  if (!event) return (
    <main className="mx-auto max-w-4xl p-6">
      <h2 className="text-2xl font-bold">{t('details.notFound')}</h2>
      <Link to="/events" className="mt-4 inline-block text-blue-600">{t('details.back')}</Link>
    </main>
  );

  const fmt = (iso: string) => formatEventDate(iso, event.timezone, 'full');

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link to="/events" className="text-sm font-medium text-blue-600">{t('details.back')}</Link>
      {event.imageUrl && <img src={event.imageUrl} alt="" className="mt-4 aspect-[21/9] w-full rounded-xl object-cover" />}

      <span className="mt-6 block text-xs font-semibold uppercase tracking-wide text-blue-600">
        {t(`categories.${categoryKey(event.category)}`, { defaultValue: event.category })}
      </span>
      <h1 className="text-3xl font-bold">{event.title}</h1>
      {event.description && <p className="mt-3 whitespace-pre-line text-gray-700">{event.description}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-2 font-semibold">{t('details.when')}</h3>
          <p>{fmt(event.startsAt)}</p>
          {event.endsAt && <p className="text-gray-600">— {fmt(event.endsAt)}</p>}
          <p className="mt-1 text-xs text-gray-500">{t('details.timezone', { tz: event.timezone })}</p>
        </section>
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-2 font-semibold">{t('details.venue')}</h3>
          <p>{event.venueName}</p>
          <p className="text-sm text-gray-600">{event.venueAddress}</p>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold">{t('details.tickets')}</h3>
        {event.ticketTiers.length === 0 && <p className="text-gray-500">{t('details.noTiers')}</p>}
        <ul className="divide-y divide-gray-100">
          {event.ticketTiers.map((tier) => (
            <li key={tier.id} className="flex items-center justify-between py-3">
              <span>{tier.name}
                {tier.remaining !== null && <span className="ml-2 text-xs text-gray-500">{tier.remaining > 0 ? t('details.left', { count: tier.remaining }) : t('details.soldOut')}</span>}
              </span>
              <strong>{formatKZT(tier.priceKZT)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <SeatingLayout tiers={event.ticketTiers} />
      <VenueMap venueName={event.venueName} venueAddress={event.venueAddress} />

      <button onClick={() => downloadIcs(event)} className="mt-6 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700">
        {t('details.addToCalendar')}
      </button>
    </main>
  );
}
