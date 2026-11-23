import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT } from '../services/events';
import { useEvent } from '../hooks/useEvent';
import { downloadIcs } from '../services/calendar';
import { formatEventDate, categoryKey } from '../i18n';
import { HybridVenueMap } from '../components/HybridVenueMap';

export function EventDetailsPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { token } = useAuth();
  const { event, state, retry } = useEvent(id, token);
  const [now] = useState(() => Date.now());

  if (state === 'loading') return <main className="mx-auto max-w-4xl p-6 text-gray-500" role="status" aria-busy="true">{t('details.loading')}</main>;
  if (state === 'error') return (
    <main className="mx-auto max-w-4xl p-6">
      <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{t('details.loadError')}</p>
      <button onClick={retry} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">{t('common.retry')}</button>
      <Link to="/events" className="ml-4 inline-block text-blue-600">{t('details.back')}</Link>
    </main>
  );
  if (!event) return (
    <main className="mx-auto max-w-4xl p-6">
      <h2 className="text-2xl font-bold">{t('details.notFound')}</h2>
      <Link to="/events" className="mt-4 inline-block text-blue-600">{t('details.back')}</Link>
    </main>
  );

  const fmt = (iso: string) => formatEventDate(iso, event.timezone, 'full');
  const isPreview = event.status === 'draft' || event.visibility !== 'public';
  const regNotOpen = event.registrationOpensAt !== null && Date.parse(event.registrationOpensAt) > now;
  const regClosed = event.registrationClosesAt !== null && Date.parse(event.registrationClosesAt) < now;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link to="/events" className="text-sm font-medium text-blue-600">{t('details.back')}</Link>
      {event.status === 'cancelled' ? (
        <div role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{t('details.cancelledBanner')}</div>
      ) : isPreview && (
        <div role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t('details.previewBanner', { status: t(`eventStatus.${event.status}`), visibility: t(`visibility.${event.visibility}`) })}
        </div>
      )}
      {event.status === 'published' && (regNotOpen || regClosed) && (
        <div role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {regNotOpen ? t('details.registrationNotOpen', { date: fmt(event.registrationOpensAt!) }) : t('details.registrationClosed')}
        </div>
      )}
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
              <span className="text-right">
                <strong>{tier.priceKZT > 0 ? formatKZT(tier.priceKZT) : t('common.free')}</strong>
                {tier.priceKZT > 0 && !event.paidSalesActive && <span className="block text-xs text-amber-700">{t('details.paidNotOnSale')}</span>}
                {tier.saleStartsAt && Date.parse(tier.saleStartsAt) > now && (
                  <span className="block text-xs text-gray-500">{t('ticketTypes.from', { date: fmt(tier.saleStartsAt) })}</span>
                )}
                {tier.saleEndsAt && Date.parse(tier.saleEndsAt) < now && (
                  <span className="block text-xs text-gray-500">{t('details.salesEnded')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <HybridVenueMap event={event} />

      <button onClick={() => downloadIcs(event)} className="mt-6 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700">
        {t('details.addToCalendar')}
      </button>
    </main>
  );
}
