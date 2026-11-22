import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiSupports, organizerApi, type Attendee, type AttendeePage } from '../../services/organizer';
import { downloadCsv, toCsv } from '../../services/csv';
import { formatEventDateTime } from '../../services/tickets';
import { Notice, type NoticeState } from '../Notice';
import { inputClass } from './EventEditor';

const PAGE = 50;
const STATUSES = ['valid', 'checked_in', 'refunded', 'cancelled'];

export function AttendeesPanel({ token, eventId, title, timezone }: { token: string; eventId: string; title: string; timezone: string }) {
  const { t } = useTranslation();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [canRefund, setCanRefund] = useState(false);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: string; page: AttendeePage | null; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    apiSupports('/api/organizer/events/{event_id}/attendees').then(setSupported);
    apiSupports('/api/organizer/orders/{order_id}/refund').then(setCanRefund);
  }, []);

  const key = `${eventId}|${status}|${offset}|${reloadKey}`;
  useEffect(() => {
    if (!supported) return;
    let live = true;
    organizerApi.attendees(token, eventId, { status, limit: PAGE, offset })
      .then((page) => { if (live) setResult({ key, page, failed: false }); })
      .catch(() => { if (live) setResult({ key, page: null, failed: true }); });
    return () => { live = false; };
  }, [token, eventId, status, offset, reloadKey, supported, key]);

  if (supported === null) return <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>;
  if (!supported) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('roster.unavailable')}</p>;

  const current = result?.key === key ? result : null;
  const page = current?.page ?? null;
  const statusLabel = (s: string) => t(`roster.status.${s}`, { defaultValue: s });

  const row = (a: Attendee) => [
    a.attendee_name ?? '', a.ticket_type ?? '', statusLabel(a.status),
    a.checked_in_at ? formatEventDateTime(a.checked_in_at, timezone) : '',
  ];

  async function exportCsv() {
    setBusy(true);
    setNotice(null);
    try {
      const rows: Attendee[] = [];
      for (let off = 0; ; off += 200) {
        const chunk = await organizerApi.attendees(token, eventId, { status, limit: 200, offset: off });
        rows.push(...chunk.items);
        if (rows.length >= chunk.total || chunk.items.length === 0) break;
      }
      const header = [t('roster.name'), t('roster.ticketType'), t('roster.statusCol'), t('roster.checkedIn')];
      downloadCsv(`${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'event'}-roster.csv`, toCsv(header, rows.map(row)));
      setNotice({ kind: 'success', text: t('roster.exported', { count: rows.length }) });
    } catch (e) {
      setNotice({ kind: 'error', text: t('roster.exportFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  async function refund(a: Attendee) {
    if (!a.order_id || !window.confirm(t('roster.confirmRefund', { name: a.attendee_name ?? '' }))) return;
    setBusy(true);
    setNotice(null);
    try {
      await organizerApi.refundOrder(token, a.order_id);
      setNotice({ kind: 'success', text: t('roster.refunded') });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setNotice({ kind: 'error', text: t('roster.refundFailed', { reason: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {!canRefund && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('roster.refundUnavailable')}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs">{t('roster.statusCol')}<br />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} className={`${inputClass} mt-0`}>
            <option value="">{t('filters.all')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>
        <button onClick={exportCsv} disabled={busy || !page || page.total === 0}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">{t('roster.export')}</button>
      </div>
      <p className="text-xs text-gray-500">{t('roster.privacy')}</p>

      {current?.failed && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {t('roster.loadFailed')} <button onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline">{t('common.retry')}</button>
        </p>
      )}
      {!current && <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>}
      {page && page.items.length === 0 && <p className="text-sm text-gray-500">{t('roster.empty')}</p>}

      {page && page.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr><th className="p-2">{t('roster.name')}</th><th className="p-2">{t('roster.ticketType')}</th><th className="p-2">{t('roster.statusCol')}</th><th className="p-2">{t('roster.checkedIn')}</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {page.items.map((a) => (
                <tr key={a.ticket_id} className="border-t">
                  <td className="p-2">{a.attendee_name || '—'}</td>
                  <td className="p-2">{a.ticket_type || '—'}</td>
                  <td className="p-2">{statusLabel(a.status)}</td>
                  <td className="p-2">{a.checked_in_at ? formatEventDateTime(a.checked_in_at, timezone) : '—'}</td>
                  <td className="p-2 text-right">
                    {canRefund && a.order_id && a.status === 'valid' && (
                      <button onClick={() => refund(a)} disabled={busy} className="text-xs font-semibold text-red-600">{t('roster.refund')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page && page.total > PAGE && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0} className="font-semibold text-blue-600 disabled:opacity-40">{t('roster.prev')}</button>
          <span>{t('roster.range', { from: offset + 1, to: Math.min(offset + PAGE, page.total), total: page.total })}</span>
          <button onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= page.total} className="font-semibold text-blue-600 disabled:opacity-40">{t('roster.next')}</button>
        </div>
      )}
    </div>
  );
}
