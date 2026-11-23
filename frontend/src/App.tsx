import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { CheckoutModal } from './components/CheckoutModal';
import { SupportDialog } from './components/SupportDialog';
import { saveCampaignPromo } from './services/tickets';
import { TicketDashboard } from './pages/TicketDashboard';
import { EventsPage } from './pages/EventsPage';
import { EventDetailsPage } from './pages/EventDetailsPage';
import { OrganizerDashboard } from './pages/OrganizerDashboard';
import { EventManageRoute } from './pages/EventManagePage';
import { AdminConsole } from './pages/admin/AdminConsole';
import { TicketView } from './pages/TicketView';
import { AuthCallbackPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages';
import { ProfilePage } from './pages/ProfilePage';
import { OrderPage } from './pages/OrderPage';
import { SupportPage } from './pages/SupportPage';
import { SupportCasePage } from './pages/SupportCasePage';
import { NotificationBell } from './components/NotificationBell';
import { NotificationsProvider } from './context/NotificationsContext';
import { RequireAuth } from './components/RequireAuth';
import { useEvent } from './hooks/useEvent';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1 text-sm font-medium transition ${isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`;

/** Buy / register button under the event page; loads the real event so prices come from the backend. */
function EventPurchase() {
  const { id = '' } = useParams();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const promo = params.get('promo');
  const { event } = useEvent(id, token);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);

  // Campaign QR: /events/:id?promo=CODE — сохраняем код и сразу открываем оформление
  useEffect(() => {
    if (!promo) return;
    saveCampaignPromo(promo);
    if (user) setOpen(true);
  }, [promo, user]);

  // drafts and cancelled events can be previewed by the owner but not bought
  if (!event || event.status !== 'published' || event.ticketTiers.length === 0) return null;
  const next = encodeURIComponent(`/events/${id}${promo ? `?promo=${promo}` : ''}`);
  return (
    <div className="mx-auto max-w-4xl px-6 pb-10">
      {promo && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{t('checkout.campaignBanner', { code: promo.toUpperCase() })}</p>}
      {user ? (
        <>
          <button onClick={() => setOpen(true)}
            className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700">{t('nav.buy')}</button>
          <CheckoutModal isOpen={open} onClose={() => setOpen(false)} event={event} />
          <button onClick={() => setHelp(true)} className="ml-4 text-sm font-semibold text-blue-600 hover:underline">{t('support.askOrganizer')}</button>
          <SupportDialog open={help} onClose={() => setHelp(false)} context={{ event_id: event.id }} contextLabel={event.title} defaultCategory="event_information" />
        </>
      ) : (
        <Link to={`/login?next=${next}`} className="inline-block rounded-lg border border-emerald-600 px-6 py-3 font-semibold text-emerald-700 hover:bg-emerald-50">
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
              {user.role === 'platform_admin' && <NavLink to="/admin" className={navClass}>{t('nav.admin')}</NavLink>}
              <NavLink to="/support" className={navClass}>{t('nav.support')}</NavLink>
              <NotificationBell />
              <NavLink to="/profile" className={navClass}>{t('nav.hello', { name: user.name || user.email })}</NavLink>
              <button onClick={async () => { await logout(); navigate('/events'); }}
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
        <Route path="/login" element={<LoginForm />} />
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/forgot" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/tickets" element={<RequireAuth><TicketDashboard /></RequireAuth>} />
        <Route path="/orders/:orderId" element={<RequireAuth><OrderPage /></RequireAuth>} />
        <Route path="/support" element={<RequireAuth><SupportPage /></RequireAuth>} />
        <Route path="/support/:caseId" element={<RequireAuth><SupportCasePage /></RequireAuth>} />
        <Route path="/tickets/:ticketId" element={<RequireAuth><TicketView /></RequireAuth>} />
        <Route path="/organizer" element={<RequireAuth roles={['organizer']}><OrganizerDashboard /></RequireAuth>} />
        <Route path="/organizer/events/new" element={<RequireAuth roles={['organizer']}><EventManageRoute /></RequireAuth>} />
        <Route path="/organizer/events/:id" element={<RequireAuth roles={['organizer']}><EventManageRoute /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth roles={['platform_admin']}><AdminConsole /></RequireAuth>} />
        <Route path="*" element={<main className="mx-auto max-w-4xl p-6"><h2 className="text-2xl font-bold">{t('nav.notFound')}</h2><Link to="/events" className="text-blue-600">{t('nav.toEvents')}</Link></main>} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationsProvider>
        <BrowserRouter>
          <MainApp />
        </BrowserRouter>
      </NotificationsProvider>
    </AuthProvider>
  );
}
