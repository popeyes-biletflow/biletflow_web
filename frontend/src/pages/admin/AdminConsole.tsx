import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useAdminList } from '../../hooks/useAdminList';
import { Notice, type NoticeState } from '../../components/Notice';
import { downloadCsv, toCsv } from '../../services/csv';
import { formatKZT } from '../../services/events';
import { adminApi, PAGE_SIZE, type AdminCase, type AdminEvent, type AdminOrder, type AdminPayment, type AdminUser } from '../../services/admin';

type Tab = 'users' | 'events' | 'orders' | 'payments' | 'support' | 'campaigns' | 'settings';
const TABS: Tab[] = ['users', 'events', 'orders', 'payments', 'support', 'campaigns', 'settings'];

const input = 'rounded-md border border-gray-300 px-3 py-2 text-sm';
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Pager({ offset, count, onChange }: { offset: number; count: number; onChange: (o: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-3 text-xs text-gray-500">
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))} className="font-semibold text-blue-600 disabled:opacity-40">{t('roster.prev')}</button>
      <span>{count === 0 ? '—' : `${offset + 1}–${offset + count}`}</span>
      <button disabled={count < PAGE_SIZE} onClick={() => onChange(offset + PAGE_SIZE)} className="font-semibold text-blue-600 disabled:opacity-40">{t('roster.next')}</button>
    </div>
  );
}

function ListState({ state, count, reload }: { state: 'loading' | 'error' | 'ok'; count: number; reload: () => void }) {
  const { t } = useTranslation();
  if (state === 'loading') return <p role="status" className="py-4 text-sm text-gray-500">{t('common.loading')}</p>;
  if (state === 'error') {
    return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t('admin.loadFailed')} <button onClick={reload} className="font-semibold underline">{t('common.retry')}</button></p>;
  }
  return count === 0 ? <p className="py-4 text-sm text-gray-500">{t('admin.empty')}</p> : null;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const cls = { ok: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-700', muted: 'bg-gray-100 text-gray-700' }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

interface SuspendTarget { kind: 'users' | 'events'; id: string; label: string }

function SuspendPanel({ target, busy, onConfirm, onCancel }: { target: SuspendTarget; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <section aria-label={t('admin.suspendTitle')} className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-4 text-sm">
      <h3 className="font-semibold">{t('admin.suspendTitle')}: {target.label}</h3>
      <label className="block">{t('admin.reason')} *
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${input} mt-1 w-full`} />
      </label>
      {!valid && reason.length > 0 && <p className="text-xs text-red-700">{t('admin.reasonShort')}</p>}
      <div className="flex gap-2">
        <button disabled={!valid || busy} onClick={() => onConfirm(reason.trim())} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{t('admin.suspendConfirm')}</button>
        <button onClick={onCancel} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold">{t('common.cancel')}</button>
      </div>
    </section>
  );
}

function useModeration(token: string, reload: () => void, setNotice: (n: NoticeState) => void) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<SuspendTarget | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => ReturnType<typeof adminApi.suspend>, doneKey: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      setNotice(res.audit_recorded
        ? { kind: 'success', text: t(doneKey) }
        : { kind: 'error', text: t('admin.auditMissing') });
      setTarget(null);
      reload();
    } catch (e) {
      setNotice({ kind: 'error', text: t('admin.actionFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  return {
    target, busy, setTarget,
    suspend: (reason: string) => target && run(() => adminApi.suspend(token, target.kind, target.id, reason), 'admin.suspended'),
    unsuspend: (kind: 'users' | 'events', id: string) => run(() => adminApi.unsuspend(token, kind, id), 'admin.unsuspended'),
  };
}

function UsersTab({ token, setNotice }: { token: string; setNotice: (n: NoticeState) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AdminUser>(() => adminApi.users(token, { q: q.trim(), role, limit: PAGE_SIZE, offset }), [token, q, role, offset]);
  const mod = useModeration(token, list.reload, setNotice);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <input type="search" aria-label={t('admin.searchUsers')} placeholder={t('admin.searchUsers')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} className={`${input} w-full sm:w-72`} />
        <select aria-label={t('admin.role')} value={role} onChange={(e) => { setRole(e.target.value); setOffset(0); }} className={input}>
          <option value="">{t('filters.all')}</option>
          {['attendee', 'organizer', 'event_admin', 'platform_admin'].map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
      </div>
      {mod.target && <SuspendPanel target={mod.target} busy={mod.busy} onConfirm={mod.suspend} onCancel={() => mod.setTarget(null)} />}
      <ListState state={list.state} count={list.rows.length} reload={list.reload} />
      {list.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="p-2">{t('admin.email')}</th><th className="p-2">{t('admin.name')}</th><th className="p-2">{t('admin.role')}</th><th className="p-2">{t('admin.state')}</th><th className="p-2" /></tr></thead>
            <tbody>
              {list.rows.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-2">{u.email}</td><td className="p-2">{u.full_name || '—'}</td><td className="p-2">{t(`roles.${u.role}`, { defaultValue: u.role })}</td>
                  <td className="p-2">{u.is_suspended ? <Badge tone="bad">{t('admin.suspendedBadge')}</Badge> : <Badge tone="ok">{t('admin.activeBadge')}</Badge>}</td>
                  <td className="p-2 text-right">
                    {u.is_suspended
                      ? <button disabled={mod.busy} onClick={() => mod.unsuspend('users', u.id)} className="text-xs font-semibold text-emerald-700">{t('admin.unsuspend')}</button>
                      : <button disabled={mod.busy} onClick={() => mod.setTarget({ kind: 'users', id: u.id, label: u.email })} className="text-xs font-semibold text-red-600">{t('admin.suspend')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={list.rows.length} onChange={setOffset} />
    </div>
  );
}

function EventsTab({ token, setNotice }: { token: string; setNotice: (n: NoticeState) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [paid, setPaid] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AdminEvent>(() => adminApi.events(token, { q: q.trim(), status, limit: PAGE_SIZE, offset }), [token, q, status, offset]);
  const mod = useModeration(token, list.reload, setNotice);
  const rows = list.rows.filter((e) => !paid || e.paid_sales_status === paid);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <input type="search" aria-label={t('admin.searchEvents')} placeholder={t('admin.searchEvents')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} className={`${input} w-full sm:w-72`} />
        <select aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={input}>
          <option value="">{t('filters.all')}</option>
          {['draft', 'published', 'cancelled'].map((s) => <option key={s} value={s}>{t(`eventStatus.${s}`)}</option>)}
        </select>
        <select aria-label={t('admin.paidSales')} value={paid} onChange={(e) => setPaid(e.target.value)} className={input}>
          <option value="">{t('admin.paidSales')}: {t('filters.all')}</option>
          {['NONE', 'ACTIVE', 'SUSPENDED'].map((s) => <option key={s} value={s}>{t(`admin.paid.${s}`)}</option>)}
        </select>
      </div>
      <p className="text-xs text-gray-500">{t('admin.activationNote')}</p>
      {mod.target && <SuspendPanel target={mod.target} busy={mod.busy} onConfirm={mod.suspend} onCancel={() => mod.setTarget(null)} />}
      <ListState state={list.state} count={rows.length} reload={list.reload} />
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="p-2">{t('admin.event')}</th><th className="p-2">{t('admin.status')}</th><th className="p-2">{t('admin.paidSales')}</th><th className="p-2">{t('admin.state')}</th><th className="p-2" /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2"><Link to={`/events/${e.id}`} className="font-medium text-blue-600">{e.title}</Link></td>
                  <td className="p-2">{t(`eventStatus.${e.status}`, { defaultValue: e.status })} · {t(`visibility.${e.visibility}`, { defaultValue: e.visibility })}</td>
                  <td className="p-2">{t(`admin.paid.${e.paid_sales_status}`, { defaultValue: e.paid_sales_status })}</td>
                  <td className="p-2">{e.is_suspended ? <Badge tone="bad">{t('admin.suspendedBadge')}</Badge> : <Badge tone="ok">{t('admin.activeBadge')}</Badge>}</td>
                  <td className="p-2 text-right">
                    {e.is_suspended
                      ? <button disabled={mod.busy} onClick={() => mod.unsuspend('events', e.id)} className="text-xs font-semibold text-emerald-700">{t('admin.unsuspend')}</button>
                      : <button disabled={mod.busy} onClick={() => mod.setTarget({ kind: 'events', id: e.id, label: e.title })} className="text-xs font-semibold text-red-600">{t('admin.suspend')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={list.rows.length} onChange={setOffset} />
    </div>
  );
}

function OrdersTab({ token }: { token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AdminOrder>(() => adminApi.orders(token, { status, user_id: userId.trim(), limit: PAGE_SIZE, offset }), [token, status, userId, offset]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <select aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={input}>
          <option value="">{t('filters.all')}</option>
          {['pending', 'paid', 'completed', 'cancelled', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input aria-label={t('admin.userId')} placeholder={t('admin.userId')} value={userId} onChange={(e) => { setUserId(e.target.value); setOffset(0); }} className={`${input} w-full font-mono sm:w-80`} />
      </div>
      <ListState state={list.state} count={list.rows.length} reload={list.reload} />
      {list.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="p-2">ID</th><th className="p-2">{t('admin.status')}</th><th className="p-2">{t('admin.amount')}</th><th className="p-2">{t('admin.created')}</th></tr></thead>
            <tbody>
              {list.rows.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{o.id.slice(0, 8)}</td>
                  <td className="p-2"><Badge tone={o.status === 'refunded' || o.status === 'cancelled' ? 'warn' : 'muted'}>{o.status}</Badge></td>
                  <td className="p-2">{formatKZT(o.total_amount ?? 0)}</td><td className="p-2">{when(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={list.rows.length} onChange={setOffset} />
    </div>
  );
}

function PaymentsTab({ token }: { token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [eventId, setEventId] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AdminPayment>(() => adminApi.payments(token, { status, event_id: eventId.trim(), limit: PAGE_SIZE, offset }), [token, status, eventId, offset]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <select aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={input}>
          <option value="">{t('filters.all')}</option>
          {['completed', 'failed', 'pending', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input aria-label={t('admin.eventId')} placeholder={t('admin.eventId')} value={eventId} onChange={(e) => { setEventId(e.target.value); setOffset(0); }} className={`${input} w-full font-mono sm:w-80`} />
      </div>
      <ListState state={list.state} count={list.rows.length} reload={list.reload} />
      {list.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="p-2">ID</th><th className="p-2">{t('admin.status')}</th><th className="p-2">{t('admin.amount')}</th><th className="p-2">{t('admin.created')}</th></tr></thead>
            <tbody>
              {list.rows.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{p.id.slice(0, 8)}</td>
                  <td className="p-2"><Badge tone={p.status === 'failed' ? 'bad' : p.status === 'refunded' ? 'warn' : 'muted'}>{p.status}</Badge>{p.simulated && <span className="ml-2 text-xs text-gray-500">{t('activation.demoBadge')}</span>}</td>
                  <td className="p-2">{formatKZT(p.amount ?? 0)}</td><td className="p-2">{when(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager offset={offset} count={list.rows.length} onChange={setOffset} />
    </div>
  );
}

function SupportTab({ token }: { token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AdminCase>(() => adminApi.cases(token, { status, limit: PAGE_SIZE, offset }), [token, status, offset]);
  return (
    <div className="space-y-3">
      <select aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={input}>
        <option value="">{t('filters.all')}</option>
        {['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <ListState state={list.state} count={list.rows.length} reload={list.reload} />
      <ul className="divide-y rounded-lg border border-gray-200">
        {list.rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <Link to={`/support/${c.id}`} className="font-medium text-blue-600">{c.subject || c.id}</Link>
              <p className="text-xs text-gray-500">{c.category} · {when(c.created_at)}</p>
            </div>
            <div className="flex gap-2">
              {c.subject?.startsWith('Escalated:') && <Badge tone="warn">{t('admin.escalated')}</Badge>}
              <Badge tone={c.status === 'RESOLVED' ? 'ok' : 'muted'}>{c.status}</Badge>
            </div>
          </li>
        ))}
      </ul>
      <Pager offset={offset} count={list.rows.length} onChange={setOffset} />
    </div>
  );
}

function SettingsTab({ token, setNotice }: { token: string; setNotice: (n: NoticeState) => void }) {
  const { t } = useTranslation();
  const [fee, setFee] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    adminApi.fee(token)
      .then((res) => { if (live) { setFee(res.activation_fee_kzt); setDraft((d) => d || String(res.activation_fee_kzt)); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token, reloadKey]);

  async function save() {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0) { setNotice({ kind: 'error', text: t('admin.feeInvalid') }); return; }
    if (!window.confirm(t('admin.feeConfirm', { fee: formatKZT(value) }))) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await adminApi.setFee(token, value);
      setFee(res.activation_fee_kzt);
      setNotice({ kind: 'success', text: t('admin.feeSaved', { fee: formatKZT(res.activation_fee_kzt) }) });
    } catch (e) {
      setNotice({ kind: 'error', text: t('admin.actionFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(kind: 'events' | 'orders') {
    setBusy(true);
    setNotice(null);
    try {
      const data = await adminApi.exportAll(token);
      const cols = kind === 'events'
        ? ['id', 'title', 'status', 'visibility', 'paid_sales_status', 'is_suspended', 'created_at']
        : ['id', 'status', 'total_amount', 'event_id', 'created_at'];
      const rows = (kind === 'events' ? data.events : data.orders).map((r) => cols.map((c) => r[c]));
      downloadCsv(`${kind}-export.csv`, toCsv(cols, rows));
      setNotice({ kind: 'success', text: t('admin.exported', { count: rows.length }) });
    } catch (e) {
      setNotice({ kind: 'error', text: t('admin.actionFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="font-semibold">{t('admin.feeTitle')}</h3>
        <p className="text-sm text-gray-600">{t('admin.feeHint')}</p>
        {failed && <p role="alert" className="text-sm text-red-700">{t('admin.loadFailed')} <button onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline">{t('common.retry')}</button></p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">{t('admin.feeLabel')}
            <input type="number" min={0} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${input} mt-1 block`} />
          </label>
          <button onClick={save} disabled={busy || fee === null} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('common.save')}</button>
        </div>
        {fee !== null && <p className="text-xs text-gray-500">{t('admin.feeCurrent', { fee: formatKZT(fee) })}</p>}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">{t('admin.exportTitle')}</h3>
        <p className="text-sm text-gray-600">{t('admin.exportHint')}</p>
        <div className="flex gap-3">
          <button onClick={() => exportCsv('events')} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">{t('admin.exportEvents')}</button>
          <button onClick={() => exportCsv('orders')} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">{t('admin.exportOrders')}</button>
        </div>
      </section>
    </div>
  );
}

export function AdminConsole() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<NoticeState>(null);
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'users';
  if (!token) return null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-extrabold">{t('admin.title')}</h1>
        <p className="text-sm text-gray-500">{t('admin.subtitle')}</p>
      </div>
      <div className="flex gap-5 overflow-x-auto border-b border-gray-200" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setNotice(null); setParams({ tab: k }, { replace: true }); }}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
            {t(`admin.tabs.${k}`)}
          </button>
        ))}
      </div>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {tab === 'users' && <UsersTab token={token} setNotice={setNotice} />}
        {tab === 'events' && <EventsTab token={token} setNotice={setNotice} />}
        {tab === 'orders' && <OrdersTab token={token} />}
        {tab === 'payments' && <PaymentsTab token={token} />}
        {tab === 'support' && <SupportTab token={token} />}
        {tab === 'campaigns' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('admin.campaignsUnavailable')}</p>}
        {tab === 'settings' && <SettingsTab token={token} setNotice={setNotice} />}
      </section>
    </main>
  );
}
