import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { http } from '../services/events';
import { PENDING_NAME_KEY, readStored, writeStored } from '../services/session';

export interface User {
  id?: string;
  name?: string;
  email: string;
  role?: 'attendee' | 'organizer' | 'event_admin' | 'platform_admin' | string;
}

interface Profile {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, token: string, userDetails?: Partial<User>) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const read = readStored;
const write = writeStored;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(read('auth_token'));
  const [user, setUser] = useState<User | null>(() => {
    const saved = read('auth_user');
    if (!saved || !read('auth_token')) return null;
    try { return JSON.parse(saved) as User; } catch { return null; }
  });

  const saveUser = (u: User | null) => {
    setUser(u);
    write('auth_user', u ? JSON.stringify(u) : null);
  };

  const logout = useCallback(() => {
    setToken(null);
    saveUser(null);
    write('auth_token', null);
  }, []);

  // Pull id / role / full_name from the backend so role-based UI (organizer dashboard) works.
  const refreshProfile = useCallback(async () => {
    if (!token) return;
    try {
      let profile = await http<Profile>('/api/users/me', {}, token);
      const pendingName = read(PENDING_NAME_KEY);
      if (pendingName && !profile.full_name) {
        profile = await http<Profile>('/api/users/me', { method: 'PUT', body: JSON.stringify({ full_name: pendingName }) }, token);
      }
      write(PENDING_NAME_KEY, null);
      saveUser({
        id: profile.id,
        email: profile.email,
        name: profile.full_name || profile.email.split('@')[0],
        role: profile.role || 'attendee',
      });
    } catch (e) {
      // Expired / invalid token → sign out instead of pretending to be logged in.
      if ((e as Error).message.toLowerCase().includes('token') || (e as Error).message.includes('401')) logout();
    }
  }, [token, logout]);

  useEffect(() => { void refreshProfile(); }, [refreshProfile]);

  const login = (email: string, authToken: string, userDetails?: Partial<User>) => {
    setToken(authToken);
    write('auth_token', authToken);
    saveUser({ email, name: userDetails?.name || email.split('@')[0], id: userDetails?.id, role: userDetails?.role });
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
