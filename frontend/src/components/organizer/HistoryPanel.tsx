import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatEventDateTime } from '../../services/tickets';
import { organizerApi, type HistoryEntry } from '../../services/organizer';
import { inputClass } from './EventEditor';

const PAGE = 20;

const summary = (m: HistoryEntry['metadata']) =>
  Object.entries(m ?? {})
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');

export function HistoryPanel({ token, eventId, timezone }: { token: string; eventId: string; timezone: string }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    organizerApi.history(token, eventId)
      .then((rows) => { if (live) { setEntries(rows); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token, eventId, reloadKey]);

  const actions = useMemo(() => [...new Set((entries ?? []).map((e) => e.action))].sort(), [entries]);
  const filtered = useMemo(() => {
    const lo = from ? Date.parse(`${from}T00:00:00`) : -Infinity;
    const hi = to ? Date.parse(`${to}T23:59:59.999`) : Infinity;
    return (entries ?? [])
      .filter((e) => (!action || e.action === action) && Date.parse(e.created_at) >= lo && Date.parse(e.created_at) <= hi)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [entries, action, from, to]);

  const label = (a: string) => t(`history.actions.${a}`, { defaultValue: a.toLowerCase().replace(/_/g, ' ') });
  const reset = () => { setAction(''); setFrom(''); setTo(''); setShown(PAGE); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">{t('history.action')}<br />
          <select value={action} onChange={(e) => { setAction(e.target.value); setShown(PAGE); }} className={`${inputClass} mt-0`}>
            <option value="">{t('filters.all')}</option>
            {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
          </select>
        </label>
        <label className="text-xs">{t('analytics.dateFrom')}<br />
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setShown(PAGE); }} className={`${inputClass} mt-0`} />
        </label>
        <label className="text-xs">{t('analytics.dateTo')}<br />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setShown(PAGE); }} className={`${inputClass} mt-0`} />
        </label>
        {(action || from || to) && <button onClick={reset} className="pb-2 text-xs font-semibold text-blue-600">{t('analytics.reset')}</button>}
      </div>

      {failed && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {t('history.loadFailed')} <button onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline">{t('common.retry')}</button>
        </p>
      )}
      {!failed && entries === null && <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p>}
      {entries && filtered.length === 0 && <p className="text-sm text-gray-500">{entries.length === 0 ? t('history.empty') : t('history.noMatch')}</p>}

      <ol className="divide-y rounded-lg border border-gray-200">
        {filtered.slice(0, shown).map((e) => (
          <li key={String(e.id)} className="p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{label(e.action)}</span>
              <time className="text-xs text-gray-500" dateTime={e.created_at}>{formatEventDateTime(e.created_at, timezone)}</time>
            </div>
            <p className="text-xs text-gray-500">{e.performed_by_name || t('history.system')}</p>
            {summary(e.metadata) && <p className="mt-1 break-words text-xs text-gray-600">{summary(e.metadata)}</p>}
          </li>
        ))}
      </ol>

      {entries && filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{t('history.showing', { shown: Math.min(shown, filtered.length), total: filtered.length })}</span>
          {shown < filtered.length && (
            <button onClick={() => setShown((n) => n + PAGE)} className="font-semibold text-blue-600">{t('history.more')}</button>
          )}
        </div>
      )}
    </div>
  );
}
