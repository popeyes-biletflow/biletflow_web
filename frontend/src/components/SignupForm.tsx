import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rememberPendingName } from '../services/session';
import { ApiError, signup as apiSignup } from '../services/api';

interface Props {
  onSwitchToLogin: () => void;
  onSuccess?: () => void;
}

export function SignupForm({ onSwitchToLogin, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password || !confirmPassword) {
      setError(t('auth.fillAll'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordsMismatch'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      await apiSignup({ email, password });
      // The backend only takes email + password; the name is saved to the profile on first login.
      rememberPendingName(name);
      setNotice(t('auth.signupDone'));
      if (onSuccess) setTimeout(onSuccess, 1500);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : t('auth.signupFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">
          {t('auth.signupTitle')}
        </h2>

        {error && (
          <div className="mb-4 rounded bg-red-100 p-2 text-center text-sm text-red-600">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded bg-emerald-100 p-2 text-center text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.namePlaceholder')}
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com"
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth.confirmPassword')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? t('auth.signingUp') : t('auth.signup')}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-600">
          <span>{t('auth.haveAccount')} </span>
          <button onClick={onSwitchToLogin} className="font-semibold text-blue-600 hover:underline">
            {t('auth.login')}
          </button>
        </div>
      </div>
    </div>
  );
}