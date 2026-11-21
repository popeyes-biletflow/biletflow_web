import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { HttpError } from '../services/events';
import { STATUS_BADGE, STATUSES, supportApi, type CaseStatus, type SupportCase, type SupportMessage } from '../services/support';

// переписка по обращению, новые сообщения подтягиваем раз в 15 секунд
export function SupportCasePage() {
  const { caseId = '' } = useParams();
  const { token, user } = useAuth();
  const { t, i18n } = useTranslation();
  const { markCaseRead, unreadCaseIds } = useNotifications();
  const [c, setCase] = useState<SupportCase | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState('');
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');

  async function load() {
    if (!token) return;
    try {
      const res = await supportApi.get(token, caseId);
      setCase(res.case);
      setMessages(res.messages);
      setStatus('ok');
      setError('');
    } catch (e) {
      // чужая ссылка — сервер отвечает 404 / 403, показываем «не найдено»
      if (e instanceof HttpError && (e.status === 404 || e.status === 403)) setStatus('missing');
      else setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, caseId]);

  // открыли переписку — уведомления по ней прочитаны
  useEffect(() => {
    if (unreadCaseIds.has(caseId)) markCaseRead(caseId);
  }, [unreadCaseIds, caseId, markCaseRead]);

  if (status === 'loading' && !error) return <main className="mx-auto max-w-3xl p-6 text-gray-500">{t('common.loading')}</main>;

  if (!c) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">{status === 'missing' ? t('support.notFound') : error}</h1>
        <Link to="/support" className="mt-4 inline-block text-blue-600">{t('support.back')}</Link>
      </main>
    );
  }

  const isRequester = c.requester_id === user?.id;
  // менять статус может админ платформы или организатор (по обращению посетителя)
  const isStaff = user?.role === 'platform_admin' || (user?.role === 'organizer' && !isRequester);
  const canEscalate = user?.role === 'organizer' && !isRequester && c.status !== 'RESOLVED';

  function fmt(iso: string | null) {
    return iso ? new Date(iso).toLocaleString(i18n.language) : '';
  }

  function whoSent(senderId: string) {
    if (senderId === user?.id) return t('support.you');
    if (senderId === c!.requester_id) return t('support.requester');
    return t('support.staff');
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !reply.trim()) return;
    setSending(true);
    try {
      await supportApi.reply(token, c!.id, reply.trim());
      setReply('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setSending(false);
  }

  async function changeStatus(newStatus: CaseStatus, assign: boolean) {
    if (!token) return;
    try {
      await supportApi.setStatus(token, c!.id, newStatus, assign);
      setInfo(assign ? t('support.assigned') : t('support.statusChanged'));
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function escalate() {
    if (!token) return;
    try {
      const res = await supportApi.escalate(token, c!.id, escalateNote);
      setShowEscalate(false);
      setEscalateNote('');
      setInfo(t('support.escalated', { id: res.escalation_case.id.slice(0, 8) }));
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link to="/support" className="text-sm text-blue-600">{t('support.back')}</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{c.subject}</h1>
          <p className="text-sm text-gray-500">{t('support.categories.' + c.category)} · {fmt(c.created_at)}</p>
          <p className="mt-1 flex flex-wrap gap-3 text-xs">
            {c.event_id && <Link to={'/events/' + c.event_id} className="text-blue-600">{t('support.ctxEvent')}</Link>}
            {c.order_id && isRequester && <Link to={'/orders/' + c.order_id} className="text-blue-600">{t('support.ctxOrder')}</Link>}
            {c.ticket_id && isRequester && <Link to={'/tickets/' + c.ticket_id} className="text-blue-600">{t('support.ctxTicket')}</Link>}
            {c.ticket_id && !isRequester && <span className="font-mono text-gray-500">{t('support.ctxTicket')}: {c.ticket_id.slice(0, 8)}</span>}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[c.status]}`}>{t('support.statuses.' + c.status)}</span>
      </div>

      {info && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{info}</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {isStaff && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <label className="text-xs text-gray-600">{t('support.status')}<br />
            <select value={c.status} onChange={(e) => changeStatus(e.target.value as CaseStatus, false)} className="mt-1 rounded-md border border-gray-300 p-1.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{t('support.statuses.' + s)}</option>)}
            </select>
          </label>
          <button onClick={() => changeStatus(c.status === 'OPEN' ? 'IN_PROGRESS' : c.status, true)} disabled={c.assigned_to === user?.id}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {c.assigned_to === user?.id ? t('support.assignedToYou') : t('support.assignToMe')}
          </button>
          {canEscalate && (
            <button onClick={() => setShowEscalate(!showEscalate)} className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-800">
              {t('support.escalate')}
            </button>
          )}
        </div>
      )}

      {showEscalate && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <label htmlFor="esc-note" className="block text-sm font-medium text-amber-900">{t('support.escalateNote')}</label>
          <textarea id="esc-note" value={escalateNote} onChange={(e) => setEscalateNote(e.target.value)} rows={3} className="w-full rounded-md border border-amber-300 p-2 text-sm" />
          <button onClick={escalate} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">{t('support.escalateSend')}</button>
        </div>
      )}

      <ol className="space-y-3" aria-live="polite">
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <li key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${mine ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white'}`}>
                <p className={`text-xs ${mine ? 'text-blue-100' : 'text-gray-500'}`}>{whoSent(m.sender_id)} · {fmt(m.created_at)}</p>
                <p className="whitespace-pre-line text-sm">{m.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {c.status === 'RESOLVED' ? (
        <p className="rounded bg-gray-100 p-3 text-sm text-gray-600">{t('support.resolvedNote')}</p>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <label htmlFor="reply" className="block text-sm font-medium">{t('support.reply')}</label>
          <textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} className="w-full rounded-md border border-gray-300 p-2 text-sm" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{t('support.pollHint')}</span>
            <button disabled={sending || !reply.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {sending ? t('common.loading') : t('support.send')}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
