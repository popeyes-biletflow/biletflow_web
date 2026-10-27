import { useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { CheckoutModal } from './components/CheckoutModal';
import { TicketDashboard } from './pages/TicketDashboard';
import { EventsPage } from './pages/EventsPage';
import { EventDetailsPage } from './pages/EventDetailsPage';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1 text-sm font-medium transition ${isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`;

function MainApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex flex-wrap items-center justify-between gap-3 bg-white px-6 py-4 shadow-sm">
        <Link to="/events" className="text-xl font-bold text-blue-600">BiletFlow</Link>
        <div className="flex flex-wrap items-center gap-2">
          <NavLink to="/events" className={navClass}>{t('nav.events')}</NavLink>
          {user ? (
            <>
              <NavLink to="/tickets" className={navClass}>{t('nav.tickets')}</NavLink>
              <span className="text-sm text-gray-600">{t('nav.hello', { name: user.name || user.email })}</span>
              <button onClick={() => { logout(); navigate('/events'); }}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-100">{t('nav.logout')}</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navClass}>{t('nav.login')}</NavLink>
              <NavLink to="/signup" className={navClass}>{t('nav.signup')}</NavLink>
            </>
          )}
          <LanguageSwitcher />
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:id" element={
          <>
            <EventDetailsPage />
            {user && (
              <div className="mx-auto max-w-4xl px-6 pb-10">
                <button onClick={() => setIsCheckoutOpen(true)}
                  className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700">{t('nav.buy')}</button>
                <CheckoutModal isOpen={isCheckoutOpen} onClose={() => setIsCheckoutOpen(false)} basePriceKZT={15000} />
              </div>
            )}
          </>
        } />
        <Route path="/login" element={<LoginForm onSwitchToSignup={() => navigate('/signup')} onSuccess={() => navigate('/events')} />} />
        <Route path="/signup" element={<SignupForm onSwitchToLogin={() => navigate('/login')} onSuccess={() => navigate('/login')} />} />
        <Route path="/tickets" element={user ? <TicketDashboard /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<main className="mx-auto max-w-4xl p-6"><h2 className="text-2xl font-bold">{t('nav.notFound')}</h2><Link to="/events" className="text-blue-600">{t('nav.toEvents')}</Link></main>} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
      <AuthProvider>
        <BrowserRouter>
          <MainApp />
        </BrowserRouter>
      </AuthProvider>
  );
}
