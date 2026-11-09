import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { CheckoutModal } from './components/CheckoutModal';
import { saveCampaignPromo } from './services/tickets';
import { TicketDashboard } from './pages/TicketDashboard';
import { EventsPage } from './pages/EventsPage';
import { EventDetailsPage } from './pages/EventDetailsPage';
import { OrganizerDashboard } from './pages/OrganizerDashboard';
import { getEvent, type EventItem } from './services/events';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1 text-sm font-medium transition ${isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`;

/** Buy / register button under the event page; loads the real event so prices come from the backend. */
function EventPurchase() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { getEvent(id).then(setEvent).catch(() => setEvent(null)); }, [id]);

  if (!event || event.ticketTiers.length === 0) return null;
  return (
    <div className="mx-auto max-w-4xl px-6 pb-10">
      {user ? (
        <>
          <button onClick={() => setOpen(true)}
            className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700">{t('nav.buy')}</button>
          <CheckoutModal isOpen={open} onClose={() => setOpen(false)} event={event} />
        </>
      ) : (
        <Link to="/login" className="inline-block rounded-lg border border-emerald-600 px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-50">
          {t('nav.loginToBuy')}
        </Link>
      )}
    </div>
  );
}

/** Campaign QR links land on /checkout?promo=CODE (backend /c/{slug}); keep the code and send the user to the events. */
function CampaignLanding() {
  const [params] = useSearchParams();
  const promo = params.get('promo');
  useEffect(() => { if (promo) saveCampaignPromo(promo); }, [promo]);
  return <Navigate to="/events" replace />;
}

function MainApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex flex-wrap items-center justify-between gap-3 bg-white px-6 py-4 shadow-sm">
        <Link to="/events" className="text-xl font-bold text-blue-600">BiletFlow</Link>
        <div className="flex flex-wrap items-center gap-2">
          <NavLink to="/events" className={navClass}>{t('nav.events')}</NavLink>
          {user ? (
            <>
              <NavLink to="/tickets" className={navClass}>{t('nav.tickets')}</NavLink>
              {user.role === 'organizer' && <NavLink to="/organizer" className={navClass}>{t('nav.organizer')}</NavLink>}
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
        <Route path="/events/:id" element={<><EventDetailsPage /><EventPurchase /></>} />
        <Route path="/checkout" element={<CampaignLanding />} />
        <Route path="/login" element={<LoginForm onSwitchToSignup={() => navigate('/signup')} onSuccess={() => navigate('/events')} />} />
        <Route path="/signup" element={<SignupForm onSwitchToLogin={() => navigate('/login')} onSuccess={() => navigate('/login')} />} />
        <Route path="/tickets" element={user ? <TicketDashboard /> : <Navigate to="/login" replace />} />
        <Route path="/organizer" element={user ? <OrganizerDashboard /> : <Navigate to="/login" replace />} />
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
