import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNotifications } from '../context/NotificationsContext';
import type { Notification } from '../services/support';

// куда ведёт уведомление: обращение, или заказ / событие (data.url приходит с бэкенда)
function linkFor(n: Notification) {
  if (n.data?.case_id) return '/support/' + n.data.case_id;
  if (typeof n.data?.url === 'string' && n.data.url.startsWith('/')) return n.data.url;
  return '/support';
}

// колокольчик в шапке: сколько непрочитанных + последние уведомления
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const { items, unreadCount, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-label={t('notifications.label', { count: unreadCount })}
        className="relative rounded-md px-2 py-1 hover:bg-gray-100">
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-1 text-xs font-semibold text-gray-500">{t('notifications.title')}</p>
          {items.length === 0 && <p className="px-2 py-4 text-center text-sm text-gray-500">{t('notifications.empty')}</p>}
          <ul className="max-h-80 overflow-y-auto">
            {items.slice(0, 15).map((n) => (
              <li key={n.id}>
                <Link to={linkFor(n)}
                  onClick={() => { markRead(n.id); setOpen(false); }}
                  className="block rounded-lg px-2 py-2 hover:bg-gray-50">
                  <p className={n.read ? 'text-sm text-gray-600' : 'text-sm font-semibold'}>{n.title}</p>
                  <p className="truncate text-xs text-gray-500">{n.message}</p>
                  <p className="text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString(i18n.language)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/support" onClick={() => setOpen(false)} className="block border-t px-2 pt-2 text-center text-xs font-semibold text-blue-600">
            {t('notifications.allCases')}
          </Link>
        </div>
      )}
    </div>
  );
}
