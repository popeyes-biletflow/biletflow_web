import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { CATEGORIES, ORGANIZER_PLATFORM_CATEGORIES, supportApi, type CaseContext, type Category } from '../services/support';

interface Props {
  open: boolean;
  onClose: () => void;
  context?: CaseContext; // событие / заказ / билет, сервер сам проверит что это моё
  contextLabel?: string;
  defaultCategory?: Category;
  platform?: boolean; // организатор пишет в поддержку платформы
}

// окно «написать в поддержку» — открывается со страницы события, заказа, билета
export function SupportDialog({ open, onClose, context, contextLabel, defaultCategory, platform }: Props) {
  const { token } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const categories = platform ? ORGANIZER_PLATFORM_CATEGORIES : CATEGORIES;
  const [category, setCategory] = useState<Category>(defaultCategory || categories[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!subject.trim() || !message.trim()) {
      setError(t('support.fillAll'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await supportApi.create(token, { category, subject: subject.trim(), message: message.trim(), ...context });
      onClose();
      navigate('/support/' + res.case.id);
    } catch (err) {
      setError(t('support.createFailed', { reason: (err as Error).message }));
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{platform ? t('support.platformTitle') : t('support.newTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-xl text-gray-400">&times;</button>
        </div>
        {contextLabel && <p className="rounded bg-gray-50 p-2 text-xs text-gray-600">{t('support.about', { what: contextLabel })}</p>}
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <label className="block text-sm">{t('support.category')}
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="mt-1 w-full rounded-md border border-gray-300 p-2">
            {categories.map((c) => <option key={c} value={c}>{t('support.categories.' + c)}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t('support.subject')}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className="mt-1 w-full rounded-md border border-gray-300 p-2" />
        </label>
        <label className="block text-sm">{t('support.message')}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} className="mt-1 w-full rounded-md border border-gray-300 p-2" />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold">{t('common.cancel')}</button>
          <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? t('common.loading') : t('support.send')}
          </button>
        </div>
      </form>
    </div>
  );
}
