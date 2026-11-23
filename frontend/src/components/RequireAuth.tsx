import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

// закрытые страницы: без входа — на логин, с неподходящей ролью — «нет доступа»
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { token, user, profileLoaded } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (!token || !user) {
    return <Navigate to={'/login?next=' + encodeURIComponent(location.pathname + location.search)} replace />;
  }

  if (roles) {
    // роль проверяем только когда профиль пришёл с сервера
    if (!profileLoaded) return <main className="p-6 text-gray-500">{t('common.loading')}</main>;
    const role = user.role || 'attendee';
    if (!roles.includes(role)) {
      return (
        <main className="mx-auto max-w-3xl p-6">
          <h1 className="text-2xl font-bold">{t('nav.noAccess')}</h1>
          <p className="mt-2 text-gray-600">{t('nav.noAccessHint', { role: t('roles.' + role) })}</p>
          <Link to="/events" className="mt-4 inline-block text-blue-600">{t('nav.toEvents')}</Link>
        </main>
      );
    }
  }

  return <>{children}</>;
}
