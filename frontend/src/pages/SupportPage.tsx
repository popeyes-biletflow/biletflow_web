import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { SupportDialog } from '../components/SupportDialog';
import { CATEGORIES, STATUS_BADGE, STATUSES, supportApi, type SupportCase } from '../services/support';

// список обращений (какие показывать, решает сервер по роли)
export function SupportPage() {
  const { token, user } = useAuth();
  const { t, i18n } = useTranslation();
  const { unreadCaseIds } = useNotifications();
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const isOrganizer = user?.role === 'organizer';

  useEffect(() => {
    if (!token) return;
    function load() {
      supportApi.list(token!, { status, category })
        .then((c) => {
          setCases(c);
          setError('');
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
    load();
    const timer = setInterval(load, 30000); // раз в 30 сек обновляем, сокеты не нужны
    return () => clearInterval(timer);
  }, [token, status, category]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">{t('support.title')}</h1>
        <button onClick={() => setShowDialog(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
          {isOrganizer ? t('support.contactPlatform') : t('support.newCase')}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">{isOrganizer ? t('support.organizerHint') : t('support.attendeeHint')}</p>

      <div className="mt-6 flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-xs text-gray-600">{t('support.status')}<br />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 rounded-md border border-gray-300 p-1.5 text-sm">
            <option value="">{t('support.all')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t('support.statuses.' + s)}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">{t('support.category')}<br />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 rounded-md border border-gray-300 p-1.5 text-sm">
            <option value="">{t('support.all')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t('support.categories.' + c)}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="py-10 text-center text-gray-500">{t('common.loading')}</p>}
      {!loading && !error && cases.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">{t('support.empty')}</p>
      )}

      <ul className="mt-6 space-y-3">
        {cases.map((c) => (
          <li key={c.id}>
            <Link to={'/support/' + c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  {unreadCaseIds.has(c.id) && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" title={t('support.unread')} />}
                  {c.subject}
                </p>
                <p className="text-xs text-gray-500">
                  {t('support.categories.' + c.category)} · {new Date(c.updated_at || c.created_at || '').toLocaleString(i18n.language)}
                  {c.requester_id === user?.id && ' · ' + t('support.mine')}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status]}`}>{t('support.statuses.' + c.status)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <SupportDialog open={showDialog} onClose={() => setShowDialog(false)} platform={isOrganizer} />
    </main>
  );
}
