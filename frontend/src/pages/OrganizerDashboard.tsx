import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatKZT } from '../services/events';
import { formatEventDateTime } from '../services/tickets';
import {
  organizerApi, PHASE_LABEL, STATUS_LABEL,
  type DashboardResponse, type EventAnalytics, type OrganizerEvent, type Phase,
} from '../services/organizer';
import { SalesChart } from '../components/organizer/SalesChart';
import { EventEditor } from '../components/organizer/EventEditor';

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

  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<OrganizerEvent | 'new' | null>(null);
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

  if (!token) return <main className="p-6">Войдите как организатор.</main>;

  if (user?.role && user.role !== 'organizer') {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h2 className="text-2xl font-bold">Панель организатора</h2>
        <p className="mt-2 text-gray-600">Раздел только для организаторов. Ваша роль: {user.role}.</p>
      </main>
    );
  }

  // выполнить действие над событием и обновить список
  async function doAction(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const t = dash?.totals;
  const list = (dash?.events ?? []).filter((a) => phase === 'all' || a.event.phase === phase);
  const selected = dash?.events.find((a) => a.event.id === selectedId);

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Панель организатора</h1>
          <p className="text-sm text-gray-500">Выручка демонстрационная, в тенге.</p>
        </div>
        <button onClick={() => setEditing('new')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          + Новое событие
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {editing && (
        <EventEditor
          token={token}
          event={editing === 'new' ? null : editing}
          onSaved={(e) => { setEditing(e); reload(); }}
          onClose={() => setEditing(null)}
        />
      )}

      {loading && <p className="py-12 text-center text-gray-500">Загрузка...</p>}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="События" value={t.events} sub={`${t.by_phase.upcoming} предстоящих, ${t.by_phase.active} идут`} />
            <StatCard
              label="Продано билетов"
              value={t.tickets_sold}
              sub={t.capacity ? `из ${t.capacity} мест` : 'без лимита'}
            />
            <StatCard label="Валовые продажи" value={formatKZT(t.gross_kzt)} sub={`скидки −${formatKZT(t.discounts_kzt)}`} />
            <StatCard label="Чистая выручка" value={formatKZT(t.net_kzt)} sub={`возвраты −${formatKZT(t.refunds_kzt)}`} />
            <StatCard label="Check-in" value={percent(t.percent_checked_in)} sub={`${t.checked_in} пришли`} />
            <StatCard label="Промокоды" value={t.promo_redemptions} sub="погашений" />
          </div>

          <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex gap-4 overflow-x-auto border-b px-4 pt-3">
              {(['all', 'upcoming', 'active', 'completed', 'cancelled'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={`whitespace-nowrap border-b-2 pb-2 text-sm font-semibold ${phase === p ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
                >
                  {p === 'all' ? `Все (${t.events})` : `${PHASE_LABEL[p]} (${t.by_phase[p]})`}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="p-3">Событие</th>
                    <th className="p-3">Статус</th>
                    <th className="w-48 p-3">Продажи</th>
                    <th className="p-3 text-right">Выручка</th>
                    <th className="p-3 text-right">Check-in</th>
                    <th className="p-3 text-right">Действия</th>
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
                            {a.event.title || 'Без названия'}
                          </button>
                          <p className="text-xs text-gray-500">{formatEventDateTime(a.event.starts_at, a.event.timezone)}</p>
                        </td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${phaseColors[a.event.phase]}`}>
                            {PHASE_LABEL[a.event.phase]}
                          </span>
                          <p className="mt-1 text-xs text-gray-500">{STATUS_LABEL[status]}</p>
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
                          <button onClick={() => setSelectedId(id)} className="text-blue-600">Аналитика</button>
                          {row && status !== 'cancelled' && (
                            <button onClick={() => setEditing(row)}>Изменить</button>
                          )}
                          {status === 'draft' && (
                            <button onClick={() => doAction(() => organizerApi.publish(token, id))} className="text-emerald-700">Опубликовать</button>
                          )}
                          {status === 'published' && (
                            <button onClick={() => doAction(() => organizerApi.unpublish(token, id))}>Снять</button>
                          )}
                          {status !== 'cancelled' && (
                            <button
                              onClick={() => {
                                if (confirm('Отменить событие? Это нельзя вернуть.')) {
                                  doAction(() => organizerApi.cancel(token, id));
                                }
                              }}
                              className="text-red-600"
                            >
                              Отменить
                            </button>
                          )}
                          <Link to={`/events/${id}`} className="text-gray-500">Открыть</Link>
                        </td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        {t.events === 0 ? 'Пока нет событий, создайте первое.' : 'В этой категории событий нет.'}
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
        <h2 className="text-xl font-bold">Аналитика: {a.event.title}</h2>
        <button onClick={onClose} className="text-sm text-gray-500">Скрыть</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-xs">С даты<br />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">По дату<br />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs">Тип билета<br />
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Все</option>
            {summary.by_ticket_type.map((tt) => (
              <option key={tt.ticket_type_id} value={tt.ticket_type_id}>{tt.name}</option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setTypeId(''); }} className="pb-2 text-xs font-semibold text-blue-600">
            Сбросить
          </button>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Продано"
          value={`${a.capacity.sold} / ${a.capacity.total ?? '∞'}`}
          sub={a.capacity.remaining !== null ? `осталось ${a.capacity.remaining}, ${percent(a.capacity.percent_sold)}` : 'без лимита'}
        />
        <StatCard label="Валовые продажи" value={formatKZT(a.revenue.gross_kzt)} sub={`${a.revenue.orders} заказов`} />
        <StatCard
          label="Чистая выручка"
          value={formatKZT(a.revenue.net_kzt)}
          sub={`скидки −${formatKZT(a.revenue.discounts_kzt)}, возвраты −${formatKZT(a.revenue.refunds_kzt)}`}
        />
        <StatCard
          label="Пришли / не пришли"
          value={`${a.attendance.checked_in} / ${a.attendance.absent}`}
          sub={`check-in ${percent(a.attendance.percent_checked_in)}`}
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-2 font-semibold">Продажи по дням</h3>
        {data?.sales_over_time ? <SalesChart points={data.sales_over_time} /> : <p className="py-10 text-center text-sm text-gray-500">Загрузка...</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">По типам билетов</h3>
          {a.by_ticket_type.length === 0 && <p className="text-sm text-gray-500">Типов билетов нет.</p>}
          {a.by_ticket_type.map((tt) => (
            <div key={tt.ticket_type_id} className="mb-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{tt.name} · {tt.price_kzt > 0 ? formatKZT(tt.price_kzt) : 'бесплатно'}</span>
                <span>{tt.sold}/{tt.capacity ?? '∞'} · {formatKZT(tt.revenue_kzt)}</span>
              </div>
              <Bar value={tt.percent_sold} />
              <p className="mt-1 text-xs text-gray-500">check-in: {tt.checked_in}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">Промокоды</h3>
          {a.campaigns.length === 0 ? (
            <p className="text-sm text-gray-500">Заказов с промокодами пока нет.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th>Код</th><th className="text-right">Погашений</th><th className="text-right">Скидка</th><th className="text-right">Выручка</th></tr>
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
            Отменено: {a.cancellations.cancelled}, возвращено: {a.cancellations.refunded}
          </p>
        </div>
      </div>
    </section>
  );
}
