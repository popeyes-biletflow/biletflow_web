import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, type Profile } from '../context/AuthContext';
import { http } from '../services/events';
import { Field } from '../components/AuthCard';

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, token, applyProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [payout, setPayout] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isOrganizer = user?.role === 'organizer';

  // берём профиль с сервера, чтобы после перезагрузки было то, что сохранено
  useEffect(() => {
    if (!token) return;
    http<Profile>('/api/users/me', {}, token)
      .then((p) => {
        setFullName(p.full_name || '');
        setPhone(p.phone_number || '');
        setPayout(p.payout_info || '');
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t('profile.nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');

    const body: Record<string, string> = { full_name: fullName.trim(), phone_number: phone.trim() };
    if (isOrganizer) body.payout_info = payout.trim(); // посетителю бэкенд payout не разрешает

    try {
      const p = await http<Profile>('/api/users/me', { method: 'PATCH', body: JSON.stringify(body) }, token);
      applyProfile({ ...p, email: p.email || user?.email || '' });
      setMessage(t('profile.saved'));
    } catch (err) {
      setError(t('profile.saveFailed', { reason: (err as Error).message }));
    }
    setSaving(false);
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-extrabold">{t('profile.title')}</h1>
      <p className="mt-1 text-sm text-gray-600">{user?.email} · {t('roles.' + (user?.role || 'attendee'))}</p>

      <form onSubmit={save} className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {message && <p className="rounded bg-emerald-100 p-2 text-sm text-emerald-800">{message}</p>}
        {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">{error}</p>}
        <Field id="pf-name" label={t('profile.fullName')} value={fullName} onChange={setFullName} />
        <Field id="pf-phone" label={t('profile.phone')} type="tel" value={phone} onChange={setPhone} placeholder="+7 7XX XXX XX XX" />
        {isOrganizer && <Field id="pf-payout" label={t('profile.payout')} value={payout} onChange={setPayout} hint={t('profile.payoutHint')} />}
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </main>
  );
}
