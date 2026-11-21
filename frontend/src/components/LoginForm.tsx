import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { ApiError, login as apiLogin, resendVerification } from '../services/api';
import { AuthCard, Field } from './AuthCard';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notConfirmed, setNotConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, sessionExpired } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // после входа возвращаем туда, откуда пришли
  let next = params.get('next') || '/events';
  if (!next.startsWith('/')) next = '/events';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNotice('');
    setNotConfirmed(false);
    if (!email || !password) {
      setError(t('auth.fillAll'));
      return;
    }

    setError('');
    setLoading(true);
    try {
      const data = await apiLogin(email, password);
      login(data); // сессию сохраняем только если вход успешный
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.message === 'EMAIL_NOT_CONFIRMED') {
        setNotConfirmed(true);
        setError(t('auth.errors.notConfirmed'));
      } else if (err instanceof ApiError && err.status === 401) {
        setError(t('auth.errors.badCredentials'));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t('auth.errors.suspended'));
      } else {
        setError(t('auth.errors.service'));
      }
    }
    setLoading(false);
  }

  async function resend() {
    try {
      await resendVerification(email);
      setNotice(t('auth.verificationResent'));
    } catch {
      setError(t('auth.errors.service'));
    }
  }

  return (
    <AuthCard title={t('auth.loginTitle')}>
      {sessionExpired && !error && <p className="mb-4 rounded bg-amber-50 p-2 text-center text-sm text-amber-800">{t('auth.sessionExpired')}</p>}
      {error && <p role="alert" className="mb-4 rounded bg-red-100 p-2 text-center text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded bg-emerald-100 p-2 text-center text-sm text-emerald-800">{notice}</p>}
      {notConfirmed && (
        <button onClick={resend} className="mb-4 w-full rounded-md border border-blue-600 py-2 text-sm text-blue-700">
          {t('auth.resendVerification')}
        </button>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="login-email" label={t('auth.email')} type="email" value={email} onChange={setEmail} />
        <Field id="login-password" label={t('auth.password')} type="password" value={password} onChange={setPassword} />
        <div className="text-right text-sm">
          <Link to="/auth/forgot" className="text-blue-600 hover:underline">{t('auth.forgot')}</Link>
        </div>
        <button type="submit" disabled={loading} className="w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? t('auth.loggingIn') : t('auth.login')}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        {t('auth.noAccount')} <Link to="/signup" className="font-semibold text-blue-600">{t('auth.signup')}</Link>
      </p>
    </AuthCard>
  );
}
