import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { formatKZT, getEvent, HttpError, type EventItem, type TicketTier } from '../services/events';
import { checkoutApi, clearCampaignPromo, formatEventDateTime, readCampaignPromo, type AttendeeInput, type Hold } from '../services/tickets';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  event: EventItem;
  initialTierId?: string;
}

// почему тип билета сейчас нельзя купить (null = можно)
function whyUnavailable(tier: TicketTier, event: EventItem) {
  const now = Date.now();
  if (tier.remaining !== null && tier.remaining <= 0) return 'soldOut';
  if (tier.priceKZT > 0 && !event.paidSalesActive) return 'paidInactive';
  if (tier.saleStartsAt && now < Date.parse(tier.saleStartsAt)) return 'notStarted';
  if (tier.saleEndsAt && now > Date.parse(tier.saleEndsAt)) return 'ended';
  return null;
}

// бэкенд отдаёт коды ошибок вроде SOLD_OUT, PROMO_EXHAUSTED — переводим их в текст
function errorCode(e: unknown) {
  if (e instanceof HttpError) {
    if (typeof e.detail === 'string' && /^[A-Z_]+$/.test(e.detail)) return e.detail;
    if (e.detail && typeof e.detail === 'object' && 'code' in e.detail) return String((e.detail as { code: string }).code);
    if (e.status === 401) return 'SESSION';
  }
  return 'GENERIC';
}

function two(n: number) {
  return n < 10 ? '0' + n : String(n);
}

export function CheckoutModal({ isOpen, onClose, event: initialEvent }: Props) {
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [event, setEvent] = useState(initialEvent);

  // шаг 1 — выбор, шаг 2 — проверка заказа и оплата
  const [step, setStep] = useState('select');
  const [tierId, setTierId] = useState(initialEvent.ticketTiers.find((x) => !whyUnavailable(x, initialEvent))?.id || '');
  const [qty, setQty] = useState(1);
  const [promo, setPromo] = useState(readCampaignPromo());
  const [attendees, setAttendees] = useState<AttendeeInput[]>([{ name: user?.name || '', email: user?.email || '' }]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [outcome, setOutcome] = useState<'approved' | 'declined'>('approved');
  const [error, setError] = useState('');
  const [promoError, setPromoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // при открытии обновляем событие (остатки, активированы ли платные продажи)
  useEffect(() => {
    if (!isOpen) return;
    getEvent(initialEvent.id, token)
      .then((ev) => setEvent(ev))
      .catch(() => {});
  }, [isOpen, initialEvent.id, token]);

  // таймер резерва
  useEffect(() => {
    if (step !== 'review') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  if (!isOpen) return null;

  const tiers = event.ticketTiers;
  const tier = tiers.find((x) => x.id === tierId);
  let maxQty = 10;
  if (tier?.maxPerOrder) maxQty = Math.min(maxQty, tier.maxPerOrder);
  if (tier?.remaining !== null && tier?.remaining !== undefined) maxQty = Math.max(1, Math.min(maxQty, tier.remaining));

  let secondsLeft = 0;
  if (hold) secondsLeft = Math.max(0, Math.floor((Date.parse(hold.hold_expires_at) - now) / 1000));
  const expired = step === 'review' && hold !== null && secondsLeft === 0;

  function changeQty(n: number) {
    const q = Math.min(maxQty, Math.max(1, n));
    setQty(q);
    // полей для посетителей столько же, сколько билетов
    const list = attendees.slice(0, q);
    while (list.length < q) list.push({ name: '', email: '' });
    setAttendees(list);
  }

  function setAttendee(i: number, field: 'name' | 'email', value: string) {
    const list = [...attendees];
    list[i] = { ...list[i], [field]: value };
    setAttendees(list);
  }

  function releaseHold() {
    if (hold && token) checkoutApi.release(token, hold.hold_id).catch(() => {});
  }

  function close() {
    if (step === 'review') releaseHold(); // ушли с оформления — билеты сразу обратно в продажу
    setStep('select');
    setHold(null);
    setError('');
    onClose();
  }

  function back() {
    releaseHold();
    setHold(null);
    setError('');
    setStep('select');
  }

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !tier) return;
    setBusy(true);
    setError('');
    setPromoError('');
    try {
      // цену и скидку считает сервер, билеты резервируются на 15 минут
      const h = await checkoutApi.hold(token, tier.id, qty, tier.priceKZT > 0 ? promo.trim() : undefined);
      setHold(h);
      setOutcome('approved');
      setNow(Date.now());
      setStep('review');
    } catch (err) {
      const code = errorCode(err);
      if (code.startsWith('PROMO_')) setPromoError(t('checkout.codes.' + code));
      else setError(t('checkout.codes.' + code, { defaultValue: t('checkout.codes.GENERIC') }));
    }
    setBusy(false);
  }

  async function pay() {
    if (!token || !hold || busy) return; // busy — защита от двойного клика
    setBusy(true);
    setError('');
    try {
      const list = attendees.map((a, i) => ({
        name: a.name.trim() || (i === 0 ? user?.name || '' : ''),
        email: a.email.trim() || (i === 0 ? user?.email || '' : ''),
      }));
      const order = await checkoutApi.confirm(token, hold.hold_id, outcome, list);
      clearCampaignPromo();
      setStep('select');
      setHold(null);
      onClose();
      navigate('/orders/' + order.order_id + '?new=1');
    } catch (err) {
      setError(t('checkout.codes.' + errorCode(err), { defaultValue: t('checkout.codes.GENERIC') }));
    }
    setBusy(false);
  }

  let payLabel = t('checkout.pay', { amount: hold ? formatKZT(hold.total_kzt) : '' });
  if (busy) payLabel = t('checkout.processing');
  else if (expired) payLabel = t('checkout.startAgain');
  else if (hold && hold.total_kzt === 0) payLabel = t('checkout.registerFree');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b pb-3">
          <h2 className="text-xl font-bold text-gray-800">{step === 'select' ? t('checkout.title') : t('checkout.reviewTitle')}</h2>
          <button onClick={close} aria-label={t('common.close')} className="text-xl font-bold text-gray-400">&times;</button>
        </div>

        <p className="font-semibold text-gray-800">{event.title}</p>
        <p className="mb-4 text-sm text-gray-500">{formatEventDateTime(event.startsAt, event.timezone)} · {event.venueName}</p>

        {step === 'select' && (
          <form onSubmit={reserve}>
            {tiers.length === 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{t('checkout.noTiers')}</p>}

            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold text-gray-600">{t('checkout.ticketType')}</p>
              {tiers.map((x) => {
                const why = whyUnavailable(x, event);
                return (
                  <label key={x.id} className={`flex items-center justify-between rounded-lg border p-3 text-sm ${tierId === x.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} ${why ? 'opacity-60' : 'cursor-pointer'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="tier" checked={tierId === x.id} disabled={!!why} onChange={() => { setTierId(x.id); changeQty(1); }} />
                      <span>
                        {x.name}
                        {why && <span className="block text-xs text-red-600">{t('checkout.unavailable.' + why)}</span>}
                        {!why && x.remaining !== null && <span className="block text-xs text-gray-500">{t('details.left', { count: x.remaining })}</span>}
                      </span>
                    </span>
                    <strong>{x.priceKZT > 0 ? formatKZT(x.priceKZT) : t('common.free')}</strong>
                  </label>
                );
              })}
            </div>

            {tiers.some((x) => whyUnavailable(x, event) === 'paidInactive') && (
              <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">{t('checkout.paidBlockedNote')}</p>
            )}

            {tier && (
              <>
                <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-50 p-3">
                  <label htmlFor="qty" className="text-sm font-medium">{t('checkout.quantity')}</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => changeQty(qty - 1)} disabled={qty <= 1} className="h-8 w-8 rounded border bg-white disabled:opacity-40">−</button>
                    <input id="qty" type="number" value={qty} onChange={(e) => changeQty(Number(e.target.value) || 1)} className="w-14 rounded border p-1 text-center" />
                    <button type="button" onClick={() => changeQty(qty + 1)} disabled={qty >= maxQty} className="h-8 w-8 rounded border bg-white disabled:opacity-40">+</button>
                  </div>
                </div>

                {tier.priceKZT > 0 && (
                  <div className="mb-4">
                    <label htmlFor="promo" className="mb-1 block text-xs font-semibold text-gray-600">{t('checkout.promo')}</label>
                    <input id="promo" value={promo} onChange={(e) => { setPromo(e.target.value.toUpperCase()); setPromoError(''); }}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase" />
                    {promoError
                      ? <p role="alert" className="mt-1 text-xs text-red-600">{promoError}</p>
                      : <p className="mt-1 text-xs text-gray-500">{promo && promo === readCampaignPromo() ? t('checkout.campaignPromo') : t('checkout.promoHint')}</p>}
                  </div>
                )}

                <div className="mb-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-600">{t('checkout.attendees')}</p>
                  {attendees.map((a, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-gray-600">{t('checkout.attendeeName', { n: i + 1 })}
                        <input value={a.name} onChange={(e) => setAttendee(i, 'name', e.target.value)} placeholder={i === 0 ? user?.name : ''}
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                      </label>
                      <label className="text-xs text-gray-600">{t('checkout.attendeeEmail')}
                        <input type="email" value={a.email} onChange={(e) => setAttendee(i, 'email', e.target.value)} placeholder={i === 0 ? user?.email : ''}
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tiers.length > 0 && tiers.every((x) => whyUnavailable(x, event)) && (
              <p className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{t('checkout.nothingAvailable')}</p>
            )}
            {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <button type="submit" disabled={busy || !tier || !!(tier && whyUnavailable(tier, event))}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? t('checkout.processing') : t('checkout.reserve')}
            </button>
          </form>
        )}

        {step === 'review' && hold && (
          <div className="space-y-4">
            <p className={`rounded-lg p-2 text-center text-sm ${expired ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'}`}>
              {expired ? t('checkout.holdExpired') : t('checkout.holdTimer', { time: two(Math.floor(secondsLeft / 60)) + ':' + two(secondsLeft % 60) })}
            </p>

            <div className="space-y-2 text-sm">
              <p className="flex justify-between"><span className="text-gray-600">{tier?.name} × {hold.quantity}</span><span>{formatKZT(hold.subtotal_kzt)}</span></p>
              {hold.discount_kzt > 0 && (
                <p className="flex justify-between text-emerald-700">
                  <span>{t('checkout.discountCode', { code: promo, percent: hold.discount_percent })}</span><span>−{formatKZT(hold.discount_kzt)}</span>
                </p>
              )}
              {hold.fee_kzt > 0 && <p className="flex justify-between text-gray-600"><span>{t('checkout.fee')}</span><span>{formatKZT(hold.fee_kzt)}</span></p>}
              <p className="flex justify-between border-t pt-2 text-base font-bold"><span>{t('checkout.total')}</span><span className="text-blue-600">{formatKZT(hold.total_kzt)}</span></p>
            </div>

            {hold.total_kzt > 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">{t('checkout.demoPayment')}</p>
                <p className="mb-2 text-xs text-amber-800">{t('checkout.simulatedNote')}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="outcome" checked={outcome === 'approved'} onChange={() => setOutcome('approved')} />
                  {t('checkout.outcome.approved')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="outcome" checked={outcome === 'declined'} onChange={() => setOutcome('declined')} />
                  {t('checkout.outcome.declined')}
                </label>
              </div>
            ) : (
              <p className="text-sm text-gray-600">{t('checkout.noPaymentNeeded')}</p>
            )}

            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <div className="flex gap-2">
              <button onClick={back} disabled={busy} className="flex-1 rounded-lg border border-gray-300 py-3 text-sm font-semibold">{t('common.back')}</button>
              <button onClick={expired ? back : pay} disabled={busy} className="flex-[2] rounded-lg bg-blue-600 py-3 font-semibold text-white disabled:opacity-50">
                {payLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
