import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginForm } from './components/LoginForm';
import { SignupForm } from './components/SignupForm';
import { CheckoutModal } from './components/CheckoutModal';
import { TicketDashboard } from './pages/TicketDashboard';

function MainApp() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<'home' | 'login' | 'signup' | 'tickets'>('home');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setView('home');
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex items-center justify-between bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-blue-600 cursor-pointer" onClick={() => setView('home')}>
          BiletFlow
        </h1>
        <div>
          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Привет, {user.name || user.email}</span>
              <button
                onClick={() => setView('tickets')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                  view === 'tickets'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                🎫 Мои билеты
              </button>
              <button
                onClick={handleLogout}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-100"
              >
                Выйти
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setView('login')}
                className="rounded-md px-3 py-1 text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Войти
              </button>
              <button
                onClick={() => setView('signup')}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
              >
                Регистрация
              </button>
            </div>
          )}
        </div>
      </nav>

      {view === 'login' && <LoginForm onSwitchToSignup={() => setView('signup')} onSuccess={() => setView('home')} />}
      {view === 'signup' && <SignupForm onSwitchToLogin={() => setView('login')} onSuccess={() => setView('home')} />}
      
      {view === 'tickets' && <TicketDashboard />}

      {view === 'home' && (
        <main className="mx-auto max-w-4xl p-6">
          <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100">
            <h2 className="text-2xl font-bold mb-2">BiletFlow Tech Conference 2026</h2>
            <p className="text-gray-600 mb-6">Главная технологическая конференция года в Астане.</p>
            
            {user ? (
              <button
                onClick={() => setIsCheckoutOpen(true)}
                className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700"
              >
                Купить билет (от 15 000 KZT)
              </button>
            ) : (
              <div className="rounded-lg bg-amber-50 p-4 text-amber-800 text-sm">
                Пожалуйста, авторизуйтесь (Войти / Регистрация), чтобы оформить заказ.
              </div>
            )}
          </div>

          <CheckoutModal
            isOpen={isCheckoutOpen}
            onClose={() => setIsCheckoutOpen(false)}
            basePriceKZT={15000}
          />
        </main>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}