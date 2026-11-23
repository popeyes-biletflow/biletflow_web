import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { rememberPendingName } from '../services/session';
import { ApiError, resendVerification, signup } from '../services/api';
import { AuthCard, Field } from './AuthCard';

export function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sentTo, setSentTo] = useState(''); // куда ушло письмо с подтверждением
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setNotice('');
    if (!name.trim() || !email || !password || !password2) {
      setError(t('auth.fillAll'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.errors.shortPassword'));
      return;
    }
    if (password !== password2) {
      setError(t('auth.passwordsMismatch'));
      return;
    }

    setError('');
    setLoading(true);
    try {
      const res = await signup(email, password, name.trim());
      rememberPendingName(name); // на всякий случай, если в profiles имя не попадёт
      if (res.email_confirmation_required) {
        setSentTo(email);
      } else {
        setNotice(t('auth.signupNoConfirm'));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError(t('auth.errors.weakPassword'));
      else if (err instanceof ApiError && err.status < 500) setError(err.message);
      else setError(t('auth.errors.service'));
    }
    setLoading(false);
  }

  async function resend() {
    try {
      await resendVerification(sentTo);
      setNotice(t('auth.verificationResent'));
    } catch {
      setError(t('auth.errors.service'));
    }
  }

  // письмо отправлено — показываем экран «проверьте почту»
  if (sentTo) {
    return (
      <AuthCard title={t('auth.checkInboxTitle')}>
        <p className="text-sm text-gray-700">{t('auth.checkInbox', { email: sentTo })}</p>
        {notice && <p className="mt-3 rounded bg-emerald-100 p-2 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-3 rounded bg-red-100 p-2 text-sm text-red-700">{error}</p>}
        <button onClick={resend} className="mt-4 w-full rounded-md border border-blue-600 py-2 text-sm text-blue-700">
          {t('auth.resendVerification')}
        </button>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="font-semibold text-blue-600">{t('auth.toLogin')}</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.signupTitle')}>
      {error && <p role="alert" className="mb-4 rounded bg-red-100 p-2 text-center text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded bg-emerald-100 p-2 text-center text-sm text-emerald-800">{notice}</p>}

      <form onSubmit={handleRegister} className="space-y-4">
        <Field id="su-name" label={t('auth.name')} value={name} onChange={setName} placeholder={t('auth.namePlaceholder')} />
        <Field id="su-email" label={t('auth.email')} type="email" value={email} onChange={setEmail} />
        <Field id="su-password" label={t('auth.password')} type="password" value={password} onChange={setPassword} hint={t('auth.passwordHint')} />
        <Field id="su-password2" label={t('auth.confirmPassword')} type="password" value={password2} onChange={setPassword2} />
        <button type="submit" disabled={loading} className="w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? t('auth.signingUp') : t('auth.signup')}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-600">
        {t('auth.haveAccount')} <Link to="/login" className="font-semibold text-blue-600">{t('auth.login')}</Link>
      </p>
    </AuthCard>
  );
}
