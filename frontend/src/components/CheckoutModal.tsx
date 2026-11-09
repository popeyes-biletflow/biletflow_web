import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { TicketPDF, type TicketDetails } from './TicketPDF';
import { formatKZT, type EventItem } from '../services/events';
import { clearCampaignPromo, formatEventDateTime, readCampaignPromo, ticketsApi, type Quote } from '../services/tickets';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: EventItem;
}

/**
 * Checkout for one ticket (SRS 4.4 / 4.6 / UC3 / UC10).
 * All amounts come from the server (`/checkout/quote`); the client never sends prices.
 * Payment is a clearly-labelled simulation — no real money moves.
 */
export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose, event }) => {
  const { user, token } = useAuth();
  const tiers = event.ticketTiers;
  const [tierId, setTierId] = useState<string>(tiers.find((t) => t.remaining !== 0)?.id ?? '');
  const [promoInput, setPromoInput] = useState(readCampaignPromo());
  const [appliedPromo, setAppliedPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [promoMsg, setPromoMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<TicketDetails | null>(null);

  // Re-price whenever the ticket type or the applied promo changes.
  useEffect(() => {
    if (!isOpen || !token || !tierId) return;
    let cancelled = false;
    setError('');
    ticketsApi
      .quote(token, event.id, tierId, appliedPromo)
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch((e: Error) => {
        if (cancelled) return;
        setQuote(null);
        if (appliedPromo) {
          setPromoMsg({ text: e.message, error: true });
          setAppliedPromo('');
        } else {
          setError(e.message);
        }
      });
    return () => { cancelled = true; };
  }, [isOpen, token, event.id, tierId, appliedPromo]);

  // Campaign QR: auto-apply the code once the modal opens.
  useEffect(() => {
    if (isOpen && promoInput && !appliedPromo) setAppliedPromo(promoInput.trim().toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (quote && appliedPromo) {
      setPromoMsg(
        quote.discount_percent > 0
          ? { text: `Промокод ${quote.promo_code} применён: скидка ${quote.discount_percent}%`, error: false }
          : { text: 'Промокод не действует на бесплатные билеты', error: true },
      );
    }
  }, [quote, appliedPromo]);

  if (!isOpen) return null;

  if (issued) {
    return <TicketPDF ticket={issued} onClose={() => { setIssued(null); onClose(); }} />;
  }

  const tier = tiers.find((t) => t.id === tierId);
  const isFree = (quote?.total_kzt ?? tier?.priceKZT ?? 0) === 0;

  const applyPromo = () => {
    setPromoMsg(null);
    setAppliedPromo(promoInput.trim().toUpperCase());
  };

  const confirm = async () => {
    if (!token || !tierId) return;
    setBusy(true);
    setError('');
    try {
      const t = await ticketsApi.register(token, event.id, tierId, quote?.promo_code ?? undefined);
      clearCampaignPromo();
      setIssued({
        ticketId: t.id,
        eventName: event.title,
        eventDate: formatEventDateTime(event.startsAt, event.timezone),
        venue: event.venueName,
        venueAddress: event.venueAddress,
        attendeeName: user?.name || user?.email || '',
        ticketType: tier?.name ?? '',
        qrPayload: t.qr_payload,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b pb-3">
          <h3 id="checkout-title" className="text-xl font-bold text-gray-800">Оформление заказа</h3>
          <button onClick={onClose} aria-label="Закрыть" className="text-xl font-bold text-gray-400 hover:text-gray-600">&times;</button>
        </div>

        <p className="font-semibold text-gray-800">{event.title}</p>
        <p className="mb-4 text-sm text-gray-500">{formatEventDateTime(event.startsAt, event.timezone)} · {event.venueName}</p>

        {tiers.length === 0 ? (
          <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">Билеты на это событие пока не продаются.</p>
        ) : (
          <fieldset className="mb-4 space-y-2">
            <legend className="mb-1 text-xs font-semibold text-gray-600">Тип билета</legend>
            {tiers.map((t) => {
              const soldOut = t.remaining !== null && t.remaining <= 0;
              return (
                <label key={t.id} className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm ${tierId === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} ${soldOut ? 'cursor-not-allowed opacity-50' : ''}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="tier" value={t.id} checked={tierId === t.id} disabled={soldOut}
                      onChange={() => setTierId(t.id)} />
                    {t.name}{soldOut && <span className="text-xs text-red-600">распродано</span>}
                  </span>
                  <strong>{t.priceKZT > 0 ? formatKZT(t.priceKZT) : 'Бесплатно'}</strong>
                </label>
              );
            })}
            <p className="text-xs text-gray-500">Один билет на аккаунт для этого события.</p>
          </fieldset>
        )}

        {!isFree && (
          <div className="mb-4">
            <label htmlFor="promo" className="mb-1 block text-xs font-semibold text-gray-600">Промокод</label>
            <div className="flex gap-2">
              <input id="promo" type="text" value={promoInput} onChange={(e) => setPromoInput(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase focus:border-blue-500 focus:outline-none" />
              <button onClick={applyPromo} disabled={!promoInput.trim()}
                className="rounded-md bg-gray-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50">
                Применить
              </button>
            </div>
            {promoMsg && <p role="status" className={`mt-1 text-xs ${promoMsg.error ? 'text-red-600' : 'text-emerald-700'}`}>{promoMsg.text}</p>}
          </div>
        )}

        {quote && (
          <dl className="mb-4 space-y-2 border-t pt-3 text-sm">
            <div className="flex justify-between text-gray-600"><dt>Стоимость билета</dt><dd>{formatKZT(quote.subtotal_kzt)}</dd></div>
            {quote.discount_kzt > 0 && (
              <div className="flex justify-between font-medium text-emerald-700"><dt>Скидка ({quote.discount_percent}%)</dt><dd>−{formatKZT(quote.discount_kzt)}</dd></div>
            )}
            {quote.fee_kzt > 0 && (
              <div className="flex justify-between text-gray-600"><dt>Сервисный сбор</dt><dd>{formatKZT(quote.fee_kzt)}</dd></div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-bold text-gray-900"><dt>Итого</dt><dd className="text-blue-600">{formatKZT(quote.total_kzt)}</dd></div>
          </dl>
        )}

        {!isFree && (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            Демонстрационная оплата: реальные деньги не списываются, данные карты не запрашиваются.
          </p>
        )}

        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button onClick={confirm} disabled={busy || !quote || !tierId}
          className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Оформляем…' : isFree ? 'Зарегистрироваться бесплатно' : `Оплатить ${quote ? formatKZT(quote.total_kzt) : ''} (симуляция)`}
        </button>
      </div>
    </div>
  );
};
