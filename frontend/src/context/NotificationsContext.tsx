import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supportApi, type Notification } from '../services/support';

interface Ctx {
  items: Notification[];
  unreadCount: number;
  unreadCaseIds: Set<string>;
  markRead: (id: string) => void;
  markCaseRead: (caseId: string) => void;
}

const NotificationsContext = createContext<Ctx>({
  items: [],
  unreadCount: 0,
  unreadCaseIds: new Set(),
  markRead: () => {},
  markCaseRead: () => {},
});

// уведомления: просто опрашиваем сервер раз в 30 секунд
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!token) {
      setItems([]);
      return;
    }
    function load() {
      supportApi.notifications(token!).then(setItems).catch(() => {});
    }
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [token]);

  function markRead(id: string) {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    if (token) supportApi.markRead(token, id).catch(() => {});
  }

  function markCaseRead(caseId: string) {
    items.forEach((n) => {
      if (!n.read && n.data?.case_id === caseId && token) supportApi.markRead(token, n.id).catch(() => {});
    });
    setItems((list) => list.map((n) => (n.data?.case_id === caseId ? { ...n, read: true } : n)));
  }

  const unread = items.filter((n) => !n.read);
  const unreadCaseIds = new Set<string>();
  unread.forEach((n) => {
    if (n.data?.case_id) unreadCaseIds.add(String(n.data.case_id));
  });

  return (
    <NotificationsContext.Provider value={{ items, unreadCount: unread.length, unreadCaseIds, markRead, markCaseRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
