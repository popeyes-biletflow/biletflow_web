import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { organizerApi, formatKZT, type EventItem, type EventForm, type EventStats, type CampaignStats } from '../services/events';

const EMPTY: EventForm = {
  title: '', description: '', category: '', starts_at: '', ends_at: '',
  timezone: 'Asia/Almaty', venue_name: '', venue_address: '', image_url: '',
};

// <input type="datetime-local"> works in local wall time; convert to/from ISO with offset for Asia/Almaty (+05:00).
const toInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16) : '');
const fromInput = (v: string) => (v ? `${v}:00+05:00` : '');

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export function OrganizerDashboard() {
  const { token } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignStats | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!token) return;
    try { setEvents(await organizerApi.list(token)); setError(''); }
    catch (e) { setError((e as Error).message); }
  };

  useEffect(() => {
    reload();
    if (token) organizerApi.campaigns(token).then(setCampaigns).catch(() => setCampaigns(null));
  }, [token]);

  useEffect(() => {
    setStats(null);
    if (token && selected) organizerApi.stats(token, selected.id).then(setStats).catch(() => setStats(null));
  }, [selected, token]);

  if (!token) return <main className="mx-auto max-w-4xl p-6">Войдите как организатор, чтобы открыть панель.</main>;

  const startEdit = (e: EventItem) => {
    setEditingId(e.id);
    setForm({
      title: e.title, description: e.description, category: e.category,
      starts_at: toInput(e.startsAt), ends_at: toInput(e.endsAt), timezone: e.timezone,
      venue_name: e.venueName, venue_address: e.venueAddress, image_url: e.imageUrl ?? '',
    });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    const body = { ...form, starts_at: fromInput(form.starts_at), ends_at: fromInput(form.ends_at) || undefined };
    try {
      if (editingId) await organizerApi.update(token, editingId, body);
      else await organizerApi.create(token, body);
      setForm(EMPTY); setEditingId(null); await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const togglePublish = async (e: EventItem) => {
    try { await organizerApi.publish(token, e.id, e.status !== 'published'); await reload(); }
    catch (err) { setError((err as Error).message); }
  };

  const remove = async (e: EventItem) => {
    if (!confirm(`Удалить «${e.title}»?`)) return;
    try { await organizerApi.remove(token, e.id); if (selected?.id === e.id) setSelected(null); await reload(); }
    catch (err) { setError((err as Error).message); }
  };

  const field = (k: keyof EventForm, label: string, type = 'text') => (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input type={type} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
    </label>
  );

  const totals = {
    sold: stats?.tickets_sold ?? 0,
    revenue: stats?.gross_revenue_kzt ?? 0,
  };

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h2 className="text-3xl font-bold">Панель организатора</h2>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Create / edit */}
      <form onSubmit={submit} className="grid gap-4 rounded-xl border border-gray-100 bg-white p-6 shadow-sm sm:grid-cols-2">
        <h3 className="text-lg font-semibold sm:col-span-2">{editingId ? 'Редактировать событие' : 'Новое событие'}</h3>
        {field('title', 'Название')}
        {field('category', 'Категория')}
        {field('starts_at', 'Начало (Астана)', 'datetime-local')}
        {field('ends_at', 'Окончание (Астана)', 'datetime-local')}
        {field('venue_name', 'Площадка')}
        {field('venue_address', 'Адрес')}
        {field('image_url', 'Ссылка на изображение', 'url')}
        <label className="block text-sm sm:col-span-2">
          <span className="text-gray-700">Описание</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <button disabled={busy || !form.title || !form.starts_at}
            className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {editingId ? 'Сохранить' : 'Создать (черновик)'}
          </button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY); }}
            className="rounded-lg border px-5 py-2">Отмена</button>}
        </div>
      </form>

      {/* My events */}
      <section className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr><th className="p-3">Событие</th><th className="p-3">Дата</th><th className="p-3">Статус</th><th className="p-3 text-right">Действия</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className={`border-t ${selected?.id === e.id ? 'bg-blue-50' : ''}`}>
                <td className="p-3 font-medium">
                  <button onClick={() => setSelected(e)} className="text-left hover:text-blue-600">{e.title}</button>
                </td>
                <td className="p-3">{new Date(e.startsAt).toLocaleString('ru-RU', { timeZone: e.timezone })}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-700'}`}>
                    {e.status === 'published' ? 'Опубликовано' : 'Черновик'}
                  </span>
                </td>
                <td className="space-x-2 p-3 text-right">
                  <button onClick={() => setSelected(e)} className="text-blue-600">Аналитика</button>
                  <button onClick={() => startEdit(e)} className="text-gray-700">Изменить</button>
                  <button onClick={() => togglePublish(e)} className="text-emerald-700">{e.status === 'published' ? 'Снять' : 'Опубликовать'}</button>
                  <Link to={`/events/${e.id}`} className="text-gray-500">Открыть</Link>
                  <button onClick={() => remove(e)} className="text-red-600">Удалить</button>
                </td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-500">Пока нет событий.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Analytics */}
      {selected && (
        <section className="space-y-4">
          <h3 className="text-xl font-semibold">Аналитика: {selected.title}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Регистрации" value={stats?.registrations ?? '—'} />
            <Stat label="Продано билетов" value={totals.sold} />
            <Stat label="Прошли check-in" value={stats?.checked_in ?? '—'} />
            <Stat label="Валовая выручка" value={formatKZT(totals.revenue)} />
          </div>
          {stats && stats.by_ticket_type.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h4 className="mb-3 font-semibold">Продажи по категориям</h4>
              {stats.by_ticket_type.map((t) => {
                const cap = t.sold + (t.remaining ?? 0);
                const pct = cap ? Math.round((t.sold / cap) * 100) : 0;
                return (
                  <div key={t.ticket_type_id} className="mb-3">
                    <div className="flex justify-between text-sm"><span>{t.name} · {formatKZT(t.price_kzt)}</span><span>{t.sold} шт · {formatKZT(t.sold * t.price_kzt)}</span></div>
                    <div className="mt-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-blue-600" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Campaign impact (PB-12 endpoint) */}
      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Эффект промо-кампаний</h3>
        {!campaigns ? (
          <p className="text-sm text-gray-500">Статистика кампаний недоступна (нужен эндпоинт GET /api/organizer/campaigns/stats из PB-12).</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-600"><tr>{Object.keys(campaigns.campaigns[0] ?? {}).map((k) => <th key={k} className="p-2 text-left">{k}</th>)}</tr></thead>
            <tbody>
              {campaigns.campaigns.map((c, i) => (
                <tr key={i} className="border-t">{Object.entries(c).map(([k, v]) => (
                  <td key={k} className="p-2">{typeof v === 'number' && k.includes('kzt') ? formatKZT(v) : String(v ?? '—')}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
