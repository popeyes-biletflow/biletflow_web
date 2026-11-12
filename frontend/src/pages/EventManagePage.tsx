import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { Notice, type NoticeState } from '../components/Notice';
import { EventEditor } from '../components/organizer/EventEditor';
import { TicketTypeManager } from '../components/organizer/TicketTypeManager';
import { PaidSalesActivation } from '../components/organizer/PaidSalesActivation';
import { formatEventDateTime } from '../services/tickets';
import { organizerApi, type OrganizerEvent, type OrganizerTicketType } from '../services/organizer';

type Tab = 'details' | 'tickets' | 'paid';
const TABS: Tab[] = ['details', 'tickets', 'paid'];

const statusBadge: Record<OrganizerEvent['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  published: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};

/** Remount per event so /organizer/events/new → /organizer/events/:id starts from a clean state. */
export function EventManageRoute() {
  const { id } = useParams();
  return <EventManagePage key={id ?? 'new'} />;
}

function EventManagePage() {
  const { id } = useParams();
  const isNew = !id;
  const location = useLocation();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'details';

  const [event, setEvent] = useState<OrganizerEvent | null>(null);
  const [types, setTypes] = useState<OrganizerTicketType[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>(isNew ? 'ok' : 'loading');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<NoticeState>(
    (location.state as { created?: boolean } | null)?.created ? { kind: 'success', text: t('manage.createdNotice') } : null,
  );
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const [events, tt] = await Promise.all([organizerApi.events(token), organizerApi.ticketTypes(token, id)]);
      const found = events.find((e) => e.id === id) ?? null;
      setEvent(found);
      setTypes(tt);
      setState(found ? 'ok' : 'missing');
    } catch (e) {
      setLoadError((e as Error).message);
      setState('error');
    }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const goTab = (next: Tab) => setParams(next === 'details' ? {} : { tab: next }, { replace: true });

  if (!token) return null;
  if (user?.role && user.role !== 'organizer') {
    return <main className="mx-auto max-w-3xl p-6"><Notice notice={{ kind: 'error', text: t('organizer.onlyOrganizers', { role: user.role }) }} /></main>;
  }
  if (state === 'loading') return <main className="mx-auto max-w-5xl p-6 text-gray-500">{t('common.loading')}</main>;
  if (state === 'error') {
    return (
      <main className="mx-auto max-w-5xl space-y-3 p-6">
        <Notice notice={{ kind: 'error', text: t('manage.loadFailed', { reason: loadError }) }} />
        <button onClick={() => { setState('loading'); load(); }} className="text-sm font-semibold text-blue-600">{t('common.retry')}</button>
      </main>
    );
  }
  if (state === 'missing') {
    return (
      <main className="mx-auto max-w-5xl space-y-3 p-6">
        <h1 className="text-2xl font-bold">{t('manage.notFound')}</h1>
        <Link to="/organizer" className="text-blue-600">{t('manage.backToDashboard')}</Link>
      </main>
    );
  }

  if (isNew || !event) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Link to="/organizer" className="text-sm font-medium text-blue-600">{t('manage.backToDashboard')}</Link>
        <h1 className="text-3xl font-extrabold">{t('manage.newTitle')}</h1>
        <p className="text-sm text-gray-600">{t('manage.newHint')}</p>
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <EventEditor token={token} event={null}
            onSaved={(e) => navigate(`/organizer/events/${e.id}?tab=tickets`, { state: { created: true } })} />
        </section>
      </main>
    );
  }

  const ev = event;
  const missingForPublish = [
    !ev.title?.trim() && t('manage.require.title'),
    !ev.starts_at && t('manage.require.date'),
    !(ev.venue_name || ev.venue_address) && t('manage.require.venue'),
    !types.some((x) => !x.is_hidden) && t('manage.require.ticketType'),
  ].filter(Boolean) as string[];

  async function run(action: 'publish' | 'unpublish' | 'cancel') {
    if (action === 'publish' && missingForPublish.length) {
      setNotice({ kind: 'error', text: t('manage.cannotPublish'), items: missingForPublish });
      return;
    }
    if (action === 'cancel' && !window.confirm(t('manage.confirmCancel', { title: ev.title }))) return;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await organizerApi[action](token!, ev.id);
      setEvent({ ...ev, ...updated });
      setNotice({ kind: 'success', text: t(`manage.done.${action}`) });
    } catch (e) {
      setNotice({ kind: 'error', text: t(`manage.failed.${action}`, { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  const cancelled = ev.status === 'cancelled';
  const paidActive = ev.paid_sales_status === 'ACTIVE';
  const hasPaid = types.some((tt) => (tt.price ?? 0) > 0);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link to="/organizer" className="text-sm font-medium text-blue-600">{t('manage.backToDashboard')}</Link>

      <header className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge[ev.status]}`}>{t(`eventStatus.${ev.status}`)}</span>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-800">{t(`visibility.${ev.visibility ?? 'public'}`)}</span>
            {hasPaid && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${paidActive ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {paidActive ? t('manage.paidActive') : t('manage.paidInactive')}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-extrabold">{ev.title || t('organizer.untitled')}</h1>
          <p className="text-sm text-gray-500">{formatEventDateTime(ev.starts_at, ev.timezone ?? 'Asia/Almaty')} · {ev.venue_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/events/${ev.id}`} target="_blank" rel="noreferrer"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50">{t('manage.preview')}</Link>
          {ev.status === 'draft' && (
            <button onClick={() => run('publish')} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {t('manage.publish')}
            </button>
          )}
          {ev.status === 'published' && (
            <button onClick={() => run('unpublish')} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
              {t('manage.unpublish')}
            </button>
          )}
          {!cancelled && (
            <button onClick={() => run('cancel')} disabled={busy} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              {t('manage.cancelEvent')}
            </button>
          )}
        </div>
      </header>

      {/* the "not ready" list goes away once the checklist is complete */}
      <Notice notice={notice?.text === t('manage.cannotPublish') && missingForPublish.length === 0 ? null : notice} onClose={() => setNotice(null)} />

      {ev.status === 'draft' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm shadow-sm">
          <h2 className="font-semibold">{t('manage.readyTitle')}</h2>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {[
              [Boolean(ev.title?.trim()), t('manage.require.title')],
              [Boolean(ev.starts_at), t('manage.require.date')],
              [Boolean(ev.venue_name || ev.venue_address), t('manage.require.venue')],
              [types.some((x) => !x.is_hidden), t('manage.require.ticketType')],
            ].map(([ok, label]) => (
              <li key={String(label)} className={ok ? 'text-emerald-700' : 'text-gray-500'}>{ok ? '✓' : '○'} {label}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">{t('manage.readyHint')}</p>
        </section>
      )}

      <div className="flex gap-6 border-b border-gray-200" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => goTab(k)}
            className={`border-b-2 pb-3 text-sm font-semibold ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
            {t(`manage.tabs.${k}`)}{k === 'tickets' ? ` (${types.length})` : ''}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {tab === 'details' && (
          <EventEditor token={token} event={ev} onSaved={(saved) => setEvent({ ...ev, ...saved })} />
        )}
        {tab === 'tickets' && (
          <TicketTypeManager token={token} eventId={ev.id} types={types} readOnly={cancelled} paidSalesActive={paidActive} onChange={setTypes} />
        )}
        {tab === 'paid' && (
          <PaidSalesActivation token={token} event={ev} types={types}
            onActivated={() => setEvent({ ...ev, paid_sales_status: 'ACTIVE' })}
            onGoToTickets={() => goTab('tickets')} />
        )}
      </section>
    </main>
  );
}
