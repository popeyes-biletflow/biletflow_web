import React, { createContext, useContext, useEffect, useState } from 'react';
import { http } from '../services/events';
import { logoutSession, refreshSession, type AuthResponse } from '../services/api';
import { PENDING_NAME_KEY, readStored, writeStored } from '../services/session';

export interface User {
  id?: string;
  name?: string;
  email: string;
  role?: string;
  phone?: string | null;
  payoutInfo?: string | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name?: string | null;
  phone_number?: string | null;
  payout_info?: string | null;
  role?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  profileLoaded: boolean;
  sessionExpired: boolean;
  login: (session: AuthResponse) => void;
  logout: () => Promise<void>;
  applyProfile: (p: Profile) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function loadUser(): User | null {
  const saved = readStored('auth_user');
  if (!saved || !readStored('auth_token')) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(readStored('auth_token'));
  const [user, setUser] = useState<User | null>(loadUser());
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  function saveUser(u: User | null) {
    setUser(u);
    writeStored('auth_user', u ? JSON.stringify(u) : null);
  }

  function clearSession() {
    setToken(null);
    saveUser(null);
    setProfileLoaded(false);
    writeStored('auth_token', null);
    writeStored('auth_refresh_token', null);
  }

  function applyProfile(p: Profile) {
    saveUser({
      id: p.id,
      email: p.email,
      name: p.full_name || p.email.split('@')[0],
      role: p.role || 'attendee',
      phone: p.phone_number,
      payoutInfo: p.payout_info,
    });
    setProfileLoaded(true);
  }

  // при каждом новом токене берём профиль с сервера (оттуда роль)
  useEffect(() => {
    if (!token) return;
    async function loadProfile() {
      try {
        let p = await http<Profile>('/api/users/me', {}, token);
        // имя, которое ввели при регистрации, сохраняем при первом входе
        const pendingName = readStored(PENDING_NAME_KEY);
        if (pendingName && !p.full_name) {
          p = await http<Profile>('/api/users/me', { method: 'PATCH', body: JSON.stringify({ full_name: pendingName }) }, token);
        }
        writeStored(PENDING_NAME_KEY, null);
        applyProfile(p);
      } catch {
        // если 401 — обработает слушатель ниже
      }
    }
    loadProfile();
  }, [token]);

  // http() кидает событие auth:unauthorized при 401.
  // Пробуем один раз обновить токен, если не получилось — выходим.
  useEffect(() => {
    let refreshing = false;
    async function onUnauthorized() {
      if (refreshing || !readStored('auth_token')) return;
      refreshing = true;
      const rt = readStored('auth_refresh_token');
      try {
        if (!rt) throw new Error('no refresh token');
        const s = await refreshSession(rt);
        writeStored('auth_token', s.access_token);
        writeStored('auth_refresh_token', s.refresh_token);
        setToken(s.access_token);
      } catch {
        clearSession();
        setSessionExpired(true);
      }
      refreshing = false;
    }
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  function login(session: AuthResponse) {
    writeStored('auth_token', session.access_token);
    writeStored('auth_refresh_token', session.refresh_token);
    setSessionExpired(false);
    setProfileLoaded(false);
    setToken(session.access_token);
    saveUser({ email: session.email, name: session.email.split('@')[0], id: session.user_id });
  }

  async function logout() {
    const old = token;
    clearSession();
    setSessionExpired(false);
    if (old) {
      try {
        await logoutSession(old); // отзываем сессию в Supabase
      } catch {
        // локально уже вышли, этого хватит
      }
    }
  }

  return (
    <AuthContext.Provider value={{ user, token, profileLoaded, sessionExpired, login, logout, applyProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
