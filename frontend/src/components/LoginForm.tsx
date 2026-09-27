import { useState } from 'react';

interface Props {
  onSwitchToSignup: () => void;
}

export function LoginForm({ onSwitchToSignup }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: any) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Заполните все поля');
      return;
    }

    setError('');
    console.log('Login attempt:', email, password);
    alert('Форма входа отправлена!');
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
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com"
              className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Пароль
            </label>
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
            className="w-full rounded-md bg-blue-600 py-2 text-white font-medium hover:bg-blue-700 transition"
          >
            Войти
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-600">
          <span>Ещё нет аккаунта? </span>
          <button
            onClick={onSwitchToSignup}
            className="font-semibold text-blue-600 hover:underline"
          >
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}