import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { ApiError, confirmPasswordReset, readAuthHash, requestPasswordReset, verifyEmail } from '../services/api';
import { AuthCard, Field } from '../components/AuthCard';

// /auth/callback — сюда Supabase перекидывает после клика по ссылке в письме
export function AuthCallbackPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    const h = readAuthHash(location.hash);

    // если это ссылка сброса пароля — отправляем на форму нового пароля
    if (h.type === 'recovery') {
      navigate('/auth/reset-password' + location.hash, { replace: true });
      return;
    }
    if (h.error || !h.accessToken) {
      setError(h.error || t('auth.errors.badLink'));
      setStatus('error');
      return;
    }

    verifyEmail(h.accessToken)
      .then((res) => {
        if (!res.verified) {
          setError(t('auth.errors.notConfirmed'));
          setStatus('error');
          return;
        }
        login({ access_token: h.accessToken!, refresh_token: h.refreshToken || '', user_id: '', email: '' });
        window.history.replaceState(null, '', '/auth/callback'); // убираем токены из адреса
        setStatus('ok');
      })
      .catch((e) => {
        setError(e instanceof ApiError && e.status === 401 ? t('auth.errors.badLink') : e.message);
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthCard title={t('auth.verifyTitle')}>
      {status === 'checking' && <p className="text-center text-gray-500">{t('common.loading')}</p>}
      {status === 'ok' && (
        <div className="space-y-4 text-center">
          <p className="rounded bg-emerald-100 p-3 text-sm text-emerald-800">{t('auth.verified')}</p>
          <Link to="/events" className="font-semibold text-blue-600">{t('nav.toEvents')}</Link>
        </div>
      )}
      {status === 'error' && (
        <div className="space-y-4 text-center">
          <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-700">{error}</p>
          <Link to="/login" className="font-semibold text-blue-600">{t('auth.toLogin')}</Link>
        </div>
      )}
    </AuthCard>
  );
}

// /auth/forgot — запросить письмо для сброса пароля
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('auth.fillAll'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(t('auth.errors.tooMany'));
      else setError(t('auth.errors.service'));
    }
    setLoading(false);
  }

  return (
    <AuthCard title={t('auth.forgotTitle')}>
      {sent ? (
        <p className="rounded bg-emerald-100 p-3 text-sm text-emerald-800">{t('auth.resetSent', { email: email })}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-gray-600">{t('auth.forgotHint')}</p>
          {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">{error}</p>}
          <Field id="fp-email" label={t('auth.email')} type="email" value={email} onChange={setEmail} />
          <button type="submit" disabled={loading} className="w-full rounded-md bg-blue-600 py-2 font-medium text-white disabled:opacity-50">
            {loading ? t('common.loading') : t('auth.sendResetLink')}
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="font-semibold text-blue-600">{t('auth.toLogin')}</Link>
      </p>
    </AuthCard>
  );
}

// /auth/reset-password#access_token=...&type=recovery — новый пароль
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [token] = useState(readAuthHash(location.hash).accessToken);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/auth/reset-password');
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError(t('auth.errors.shortPassword'));
      return;
    }
    if (password !== password2) {
      setError(t('auth.passwordsMismatch'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await confirmPasswordReset(token!, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('auth.errors.badLink'));
      else setError(t('auth.errors.service'));
    }
    setLoading(false);
  }

  if (!token) {
    return (
      <AuthCard title={t('auth.resetTitle')}>
        <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-700">{t('auth.errors.badLink')}</p>
        <p className="mt-4 text-center text-sm"><Link to="/auth/forgot" className="font-semibold text-blue-600">{t('auth.forgot')}</Link></p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title={t('auth.resetTitle')}>
        <p className="rounded bg-emerald-100 p-3 text-center text-sm text-emerald-800">{t('auth.passwordChanged')}</p>
        <p className="mt-4 text-center"><Link to="/login" className="font-semibold text-blue-600">{t('auth.toLogin')}</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.resetTitle')}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded bg-red-100 p-2 text-sm text-red-700">{error}</p>}
        <Field id="rp-pass" label={t('auth.newPassword')} type="password" value={password} onChange={setPassword} hint={t('auth.passwordHint')} />
        <Field id="rp-pass2" label={t('auth.confirmPassword')} type="password" value={password2} onChange={setPassword2} />
        <button type="submit" disabled={loading} className="w-full rounded-md bg-blue-600 py-2 font-medium text-white disabled:opacity-50">
          {loading ? t('common.saving') : t('auth.savePassword')}
        </button>
      </form>
    </AuthCard>
  );
}
