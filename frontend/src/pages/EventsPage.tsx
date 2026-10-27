import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getEvents, formatKZT, type EventItem } from '../services/events';
import { formatEventDate, categoryKey } from '../i18n';

export function EventsPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? 'all';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (!v || v === 'all') next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    getEvents().then(setEvents).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  const catLabel = (raw: string) => t(`categories.${categoryKey(raw)}`, { defaultValue: raw });
  const categories = useMemo(() => [...new Set(events.map((e) => e.category))].sort(), [events]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => !needle || [e.title, e.description, e.venueName, e.venueAddress, catLabel(e.category)].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, q, category, t]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h2 className="mb-4 text-3xl font-bold">{t('discovery.title')}</h2>

      <label htmlFor="event-search" className="sr-only">{t('discovery.searchLabel')}</label>
      <input id="event-search" type="search" value={q} onChange={(e) => setParam('q', e.target.value)} placeholder={t('discovery.searchPlaceholder')}
        className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-blue-500 focus:outline-none" />

      <div role="group" aria-label={t('filters.label')} className="mb-4 flex flex-wrap gap-2">
        {['all', ...categories].map((c) => (
          <button key={c} onClick={() => setParam('category', c)} aria-pressed={category === c}
            className={`rounded-full border px-4 py-1 text-sm font-medium ${category === c ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>
            {c === 'all' ? t('filters.all') : catLabel(c)}
          </button>
        ))}
      </div>

      {!loading && !error && (
        <p className="mb-4 text-sm text-gray-500">
          {t('discovery.results', { count: visible.length })}
          {(q || category !== 'all') && <button onClick={() => setParams({}, { replace: true })} className="ml-3 text-blue-600 hover:underline">{t('discovery.clear')}</button>}
        </p>
      )}
      {loading && <p className="text-gray-500">{t('discovery.loading')}</p>}
      {error && <p className="rounded-lg bg-red-50 p-4 text-red-700">{t('discovery.error')}</p>}
      {!loading && !error && visible.length === 0 && <p className="text-gray-500">{t('discovery.empty')}</p>}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((e) => {
          const minPrice = e.ticketTiers.length ? Math.min(...e.ticketTiers.map((x) => x.priceKZT)) : null;
          return (
            <Link key={e.id} to={`/events/${e.id}`} className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
              {e.imageUrl
                ? <img src={e.imageUrl} alt="" className="aspect-video w-full object-cover" />
                : <div className="flex aspect-video items-center justify-center bg-blue-50 text-xl font-bold text-blue-600">BiletFlow</div>}
              <div className="p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">{catLabel(e.category)}</span>
                <h3 className="mt-1 text-lg font-bold">{e.title}</h3>
                <p className="mt-1 text-sm text-gray-600">
                  {formatEventDate(e.startsAt, e.timezone, 'card')}
                </p>
                <p className="text-sm text-gray-600">{e.venueName}</p>
                {minPrice !== null && <p className="mt-2 font-semibold text-emerald-700">{t('discovery.from', { price: formatKZT(minPrice) })}</p>}
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
