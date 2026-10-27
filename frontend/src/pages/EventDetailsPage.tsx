import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getEvent, formatKZT, type EventItem } from '../services/events';
import { downloadIcs } from '../services/calendar';
import { useLanguage } from '../i18n/LanguageContext';

export function EventDetailsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useLanguage();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    getEvent(id).then((e) => { setEvent(e); setState('ok'); }).catch(() => setState('missing'));
  }, [id]);

  if (state === 'loading') return <main className="mx-auto max-w-4xl p-6 text-gray-500">{t('loading')}</main>;
  if (!event) return (
    <main className="mx-auto max-w-4xl p-6">
      <h2 className="text-2xl font-bold">{t('notFound')}</h2>
      <Link to="/events" className="mt-4 inline-block text-blue-600">{t('back')}</Link>
    </main>
  );

  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone }).format(new Date(iso));
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venueName} ${event.venueAddress}`)}`;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link to="/events" className="text-sm font-medium text-blue-600">{t('back')}</Link>
      {event.imageUrl && <img src={event.imageUrl} alt="" className="mt-4 aspect-[21/9] w-full rounded-xl object-cover" />}

      <span className="mt-6 block text-xs font-semibold uppercase tracking-wide text-blue-600">{event.category}</span>
      <h1 className="text-3xl font-bold">{event.title}</h1>
      {event.description && <p className="mt-3 whitespace-pre-line text-gray-700">{event.description}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-2 font-semibold">{t('when')}</h3>
          <p>{fmt(event.startsAt)}</p>
          {event.endsAt && <p className="text-gray-600">— {fmt(event.endsAt)}</p>}
          <p className="mt-1 text-xs text-gray-500">{event.timezone}</p>
        </section>
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-2 font-semibold">{t('venue')}</h3>
          <p>{event.venueName}</p>
          <a href={mapUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">{event.venueAddress}</a>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold">{t('tickets')}</h3>
        <ul className="divide-y">
          {event.ticketTiers.map((tier) => (
            <li key={tier.id} className="flex items-center justify-between py-3">
              <span>{tier.name}{tier.remaining !== null && <span className="ml-2 text-xs text-gray-500">{tier.remaining > 0 ? `${tier.remaining} ${t('left')}` : t('soldOut')}</span>}</span>
              <strong>{formatKZT(tier.priceKZT)}</strong>
            </li>
          ))}
        </ul>
      </section>

      <button onClick={() => downloadIcs(event)}
        className="mt-6 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700">
        {t('addCal')}
      </button>
    </main>
  );
}
