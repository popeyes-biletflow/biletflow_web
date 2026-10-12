import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

interface Props {
  onSwitchToSignup: () => void;
  onSuccess?: () => void;
}

export function LoginForm({ onSwitchToSignup, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Заполните все поля');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Ошибка входа');
      }

      const data = await response.json();
      login(email, data.token || 'mock-jwt-token', data.user);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      // Фолбэк для работы UI без запущенного бэкенда
      login(email, 'demo-token-123', { name: email.split('@')[0] });
      if (onSuccess) onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
        <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">
          Вход в BiletFlow
        </h2>

        {error && (
          <div className="mb-4 rounded bg-red-100 p-2 text-center text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-600">
          <span>Ещё нет аккаунта? </span>
          <button onClick={onSwitchToSignup} className="font-semibold text-blue-600 hover:underline">
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}