import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT } from '../services/events';
import { formatEventDateTime } from '../services/tickets';
import {
  organizerApi,
  type DashboardResponse, type EventAnalytics, type OrganizerEvent, type Phase,
} from '../services/organizer';
import { SalesChart } from '../components/organizer/SalesChart';
import { Notice, type NoticeState } from '../components/Notice';

function percent(v: number | null) {
  return v === null ? '—' : v + '%';
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// полоска прогресса
function Bar({ value }: { value: number | null }) {
  return (
    <div className="h-2 w-full rounded-full bg-blue-100">
      <div className="h-2 rounded-full bg-blue-600" style={{ width: Math.min(value ?? 0, 100) + '%' }} />
    </div>
  );
}

const phaseColors: Record<Phase, string> = {
  upcoming: 'bg-blue-50 text-blue-800',
  active: 'bg-emerald-50 text-emerald-800',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-50 text-red-800',
};

export function OrganizerDashboard() {
  const { token, user } = useAuth();
  const { t: tr } = useTranslation();
  const navigate = useNavigate();

  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function reload() {
    if (!token) return;
    try {
      const d = await organizerApi.dashboard(token);
      const e = await organizerApi.events(token);
      setDash(d);
      setEvents(e);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, [token]);

  if (!token) return <main className="p-6">{tr('organizer.signIn')}</main>;

  if (user?.role && user.role !== 'organizer') {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h2 className="text-2xl font-bold">{tr('organizer.title')}</h2>
        <p className="mt-2 text-gray-600">{tr('organizer.onlyOrganizers', { role: user.role })}</p>
      </main>
    );
  }

  // выполнить действие над событием и обновить список
  async function doAction(action: 'publish' | 'unpublish' | 'cancel', id: string) {
    setNotice(null);
    try {
      await organizerApi[action](token!, id);
      setNotice({ kind: 'success', text: tr(`manage.done.${action}`) });
      await reload();
    } catch (err) {
      setNotice({ kind: 'error', text: tr(`manage.failed.${action}`, { reason: (err as Error).message }) });
    }
  }

  const t = dash?.totals;
  const list = (dash?.events ?? []).filter((a) => phase === 'all' || a.event.phase === phase);
  const selected = dash?.events.find((a) => a.event.id === selectedId);

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{tr('organizer.title')}</h1>
          <p className="text-sm text-gray-500">{tr('organizer.subtitle')}</p>
        </div>
        <button onClick={() => navigate('/organizer/events/new')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          + {tr('organizer.newEvent')}
        </button>
      </div>

      {error && <Notice notice={{ kind: 'error', text: tr('organizer.loadFailed', { reason: error }) }} />}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {loading && <p className="py-12 text-center text-gray-500">{tr('common.loading')}</p>}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label={tr('organizer.stats.events')} value={t.events} sub={tr('organizer.stats.eventsSub', { upcoming: t.by_phase.upcoming, active: t.by_phase.active })} />
            <StatCard
              label={tr('organizer.stats.sold')}
              value={t.tickets_sold}
              sub={t.capacity ? tr('organizer.stats.ofSeats', { count: t.capacity }) : tr('organizer.stats.unlimited')}
            />
            <StatCard label={tr('organizer.stats.gross')} value={formatKZT(t.gross_kzt)} sub={tr('organizer.stats.discounts', { amount: formatKZT(t.discounts_kzt) })} />
            <StatCard label={tr('organizer.stats.net')} value={formatKZT(t.net_kzt)} sub={tr('organizer.stats.refunds', { amount: formatKZT(t.refunds_kzt) })} />
            <StatCard label={tr('organizer.stats.checkIn')} value={percent(t.percent_checked_in)} sub={tr('organizer.stats.came', { count: t.checked_in })} />
            <StatCard label={tr('organizer.stats.promo')} value={t.promo_redemptions} sub={tr('organizer.stats.redemptions')} />
          </div>

          <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex gap-4 overflow-x-auto border-b px-4 pt-3">
              {(['all', 'upcoming', 'active', 'completed', 'cancelled'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={`whitespace-nowrap border-b-2 pb-2 text-sm font-semibold ${phase === p ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
                >
                  {p === 'all' ? `${tr('filters.all')} (${t.events})` : `${tr(`phase.${p}`)} (${t.by_phase[p]})`}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="p-3">{tr('organizer.table.event')}</th>
                    <th className="p-3">{tr('organizer.table.status')}</th>
                    <th className="w-48 p-3">{tr('organizer.table.sales')}</th>
                    <th className="p-3 text-right">{tr('organizer.table.revenue')}</th>
                    <th className="p-3 text-right">{tr('organizer.stats.checkIn')}</th>
                    <th className="p-3 text-right">{tr('organizer.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => {
                    const row = events.find((e) => e.id === a.event.id);
                    const status = (row?.status ?? a.event.status) as OrganizerEvent['status'];
                    const id = a.event.id;
                    return (
                      <tr key={id} className="border-t">
                        <td className="p-3">
                          <button onClick={() => setSelectedId(id)} className="text-left font-medium hover:text-blue-600">
                            {a.event.title || tr('organizer.untitled')}
                          </button>
                          <p className="text-xs text-gray-500">{formatEventDateTime(a.event.starts_at, a.event.timezone)}</p>
                        </td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${phaseColors[a.event.phase]}`}>
                            {tr(`phase.${a.event.phase}`)}
                          </span>
                          <p className="mt-1 text-xs text-gray-500">{tr(`eventStatus.${status}`)}</p>
                        </td>
                        <td className="p-3">
                          <p className="mb-1 text-xs">
                            {a.capacity.sold} / {a.capacity.total ?? '∞'} ({percent(a.capacity.percent_sold)})
                          </p>
                          <Bar value={a.capacity.percent_sold} />
                        </td>
                        <td className="p-3 text-right">{formatKZT(a.revenue.net_kzt)}</td>
                        <td className="p-3 text-right">{percent(a.attendance.percent_checked_in)}</td>
                        <td className="space-x-3 whitespace-nowrap p-3 text-right text-xs font-semibold">
                          <button onClick={() => setSelectedId(id)} className="text-blue-600">{tr('organizer.analytics')}</button>
                          <Link to={`/organizer/events/${id}`}>{tr('organizer.manage')}</Link>
                          {status === 'draft' && (
                            <button onClick={() => doAction('publish', id)} className="text-emerald-700">{tr('manage.publish')}</button>
                          )}
                          {status === 'published' && (
                            <button onClick={() => doAction('unpublish', id)}>{tr('manage.unpublish')}</button>
                          )}
                          {status !== 'cancelled' && (
                            <button
                              onClick={() => {
                                if (window.confirm(tr('manage.confirmCancel', { title: a.event.title }))) doAction('cancel', id);
                              }}
                              className="text-red-600"
                            >
                              {tr('manage.cancelEvent')}
                            </button>
                          )}
                          <Link to={`/events/${id}`} target="_blank" rel="noreferrer" className="text-gray-500">{tr('manage.preview')}</Link>
                        </td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        {t.events === 0 ? tr('organizer.noEvents') : tr('organizer.noEventsInPhase')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selected && <EventAnalyticsPanel token={token} summary={selected} onClose={() => setSelectedId(null)} />}
        </>
      )}
    </main>
  );
}

// детальная аналитика одного события
function EventAnalyticsPanel({ token, summary, onClose }: { token: string; summary: EventAnalytics; onClose: () => void }) {
  const { t } = useTranslation();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeId, setTypeId] = useState('');
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    organizerApi
      .analytics(token, summary.event.id, { date_from: dateFrom, date_to: dateTo, ticket_type_id: typeId })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }, [token, summary.event.id, dateFrom, dateTo, typeId]);

  const a = data ?? summary;
  const hasFilters = dateFrom || dateTo || typeId;

  return (
    <section className="space-y-5">
      <div className="flex justify-between">
        <h2 className="text-xl font-bold">{t('analytics.title', { title: a.event.title })}</h2>
        <button onClick={onClose} className="text-sm text-gray-500">{t('analytics.hide')}</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-xs">{t('analytics.dateFrom')}<br />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">{t('analytics.dateTo')}<br />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">{t('analytics.ticketType')}<br />
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">{t('filters.all')}</option>
            {summary.by_ticket_type.map((tt) => (
              <option key={tt.ticket_type_id} value={tt.ticket_type_id}>{tt.name}</option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setTypeId(''); }} className="pb-2 text-xs font-semibold text-blue-600">
            {t('analytics.reset')}
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t('analytics.sold')}
          value={`${a.capacity.sold} / ${a.capacity.total ?? '∞'}`}
          sub={a.capacity.remaining !== null ? t('analytics.remaining', { count: a.capacity.remaining, percent: percent(a.capacity.percent_sold) }) : t('organizer.stats.unlimited')}
        />
        <StatCard label={t('organizer.stats.gross')} value={formatKZT(a.revenue.gross_kzt)} sub={t('analytics.orders', { count: a.revenue.orders })} />
        <StatCard
          label={t('organizer.stats.net')}
          value={formatKZT(a.revenue.net_kzt)}
          sub={`${t('organizer.stats.discounts', { amount: formatKZT(a.revenue.discounts_kzt) })}, ${t('organizer.stats.refunds', { amount: formatKZT(a.revenue.refunds_kzt) })}`}
        />
        <StatCard
          label={t('analytics.attendance')}
          value={`${a.attendance.checked_in} / ${a.attendance.absent}`}
          sub={`${t('organizer.stats.checkIn')} ${percent(a.attendance.percent_checked_in)}`}
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-2 font-semibold">{t('analytics.salesByDay')}</h3>
        {data?.sales_over_time ? <SalesChart points={data.sales_over_time} /> : <p className="py-10 text-center text-sm text-gray-500">{t('common.loading')}</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">{t('analytics.byType')}</h3>
          {a.by_ticket_type.length === 0 && <p className="text-sm text-gray-500">{t('analytics.noTypes')}</p>}
          {a.by_ticket_type.map((tt) => (
            <div key={tt.ticket_type_id} className="mb-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{tt.name} · {tt.price_kzt > 0 ? formatKZT(tt.price_kzt) : t('common.free')}</span>
                <span>{tt.sold}/{tt.capacity ?? '∞'} · {formatKZT(tt.revenue_kzt)}</span>
              </div>
              <Bar value={tt.percent_sold} />
              <p className="mt-1 text-xs text-gray-500">{t('organizer.stats.checkIn')}: {tt.checked_in}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">{t('organizer.stats.promo')}</h3>
          {a.campaigns.length === 0 ? (
            <p className="text-sm text-gray-500">{t('analytics.noPromo')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th>{t('analytics.code')}</th><th className="text-right">{t('analytics.redemptions')}</th><th className="text-right">{t('analytics.discount')}</th><th className="text-right">{t('organizer.table.revenue')}</th></tr>
              </thead>
              <tbody>
                {a.campaigns.map((c) => (
                  <tr key={c.code} className="border-t">
                    <td className="py-2 font-mono">{c.code}</td>
                    <td className="text-right">{c.redemptions}</td>
                    <td className="text-right">−{formatKZT(c.discount_kzt)}</td>
                    <td className="text-right">{formatKZT(c.net_kzt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-gray-500">
            {t('analytics.cancellations', { cancelled: a.cancellations.cancelled, refunded: a.cancellations.refunded })}
          </p>
        </div>
      </div>
    </section>
  );
}
