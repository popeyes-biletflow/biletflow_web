import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { TicketPDF, type TicketDetails } from './TicketPDF';
import { formatKZT, getEvent, HttpError, type EventItem, type TicketTier } from '../services/events';
import { clearCampaignPromo, formatEventDateTime, readCampaignPromo, ticketsApi, type Quote } from '../services/tickets';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: EventItem;
}

type Unavailable = 'soldOut' | 'paidInactive' | 'notStarted' | 'ended' | null;

function tierUnavailable(tier: TicketTier, event: EventItem, now = Date.now()): Unavailable {
  if (tier.remaining !== null && tier.remaining <= 0) return 'soldOut';
  if (tier.priceKZT > 0 && !event.paidSalesActive) return 'paidInactive';
  if (tier.saleStartsAt && now < Date.parse(tier.saleStartsAt)) return 'notStarted';
  if (tier.saleEndsAt && now > Date.parse(tier.saleEndsAt)) return 'ended';
  return null;
}

interface Confirmation {
  orderId: string;
  total: number;
  ticket: TicketDetails;
}

/**
 * Checkout for one ticket (SRS 4.4 / 4.6 / UC3 / UC10).
 * All amounts come from the server (`/checkout/quote`); the client never sends prices.
 * Payment is a clearly-labelled simulation — no real money moves.
 */
export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose, event: initialEvent }) => {
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [event, setEvent] = useState(initialEvent);
  const tiers = event.ticketTiers;
  const firstAvailable = (ev: EventItem) => ev.ticketTiers.find((x) => !tierUnavailable(x, ev))?.id ?? '';
  const [tierId, setTierId] = useState<string>(firstAvailable(initialEvent));
  const [promoInput, setPromoInput] = useState(readCampaignPromo());
  const [appliedPromo, setAppliedPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [promoMsg, setPromoMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showTicket, setShowTicket] = useState(false);

  // Fresh event state on open, so a just-activated paid tier is purchasable without a page reload.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getEvent(initialEvent.id, token)
      .then((ev) => {
        if (cancelled) return;
        setEvent(ev);
        setTierId((current) => {
          const tier = ev.ticketTiers.find((x) => x.id === current);
          return tier && !tierUnavailable(tier, ev) ? current : firstAvailable(ev);
        });
      })
      .catch(() => { /* keep the event we already have */ });
    return () => { cancelled = true; };
  }, [isOpen, initialEvent.id, token]);

  const friendlyError = (e: unknown) => {
    if (e instanceof HttpError) {
      if (e.status === 402) return t('checkout.errors.paidInactive');
      if (e.status === 409) return t('checkout.errors.alreadyRegistered');
      if (e.status === 401) return t('checkout.errors.sessionExpired');
    }
    return t('checkout.errors.generic', { reason: (e as Error).message });
  };

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
          setError(friendlyError(e));
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          ? { text: t('checkout.promoApplied', { code: quote.promo_code, percent: quote.discount_percent }), error: false }
          : { text: t('checkout.promoNotForFree'), error: true },
      );
    }
  }, [quote, appliedPromo, t]);

  if (!isOpen) return null;

  const close = () => { setConfirmation(null); setShowTicket(false); onClose(); };

  if (confirmation && showTicket) {
    return <TicketPDF ticket={confirmation.ticket} onClose={close} />;
  }

  const tier = tiers.find((x) => x.id === tierId);
  const isFree = (quote?.total_kzt ?? tier?.priceKZT ?? 0) === 0;
  const paidBlocked = tiers.some((x) => tierUnavailable(x, event) === 'paidInactive');
  const nothingAvailable = tiers.length > 0 && tiers.every((x) => tierUnavailable(x, event));

  const applyPromo = () => {
    setPromoMsg(null);
    setAppliedPromo(promoInput.trim().toUpperCase());
  };

  const confirm = async () => {
    if (!token || !tierId) return;
    setBusy(true);
    setError('');
    try {
      const issued = await ticketsApi.register(token, event.id, tierId, quote?.promo_code ?? undefined);
      clearCampaignPromo();
      setConfirmation({
        orderId: issued.order_id,
        total: issued.pricing?.total_kzt ?? quote?.total_kzt ?? 0,
        ticket: {
          ticketId: issued.id,
          eventName: event.title,
          eventDate: formatEventDateTime(event.startsAt, event.timezone),
          venue: event.venueName,
          venueAddress: event.venueAddress,
          attendeeName: user?.name || user?.email || '',
          ticketType: tier?.name ?? '',
          qrPayload: issued.qr_payload,
        },
      });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b pb-3">
          <h3 id="checkout-title" className="text-xl font-bold text-gray-800">
            {confirmation ? t(confirmation.total === 0 ? 'checkout.freeConfirmedTitle' : 'checkout.paidConfirmedTitle') : t('checkout.title')}
          </h3>
          <button onClick={close} aria-label={t('common.close')} className="text-xl font-bold text-gray-400 hover:text-gray-600">&times;</button>
        </div>

        {confirmation ? (
          <div role="status" className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">
                {confirmation.total === 0 ? t('checkout.freeConfirmed') : t('checkout.paidConfirmed')}
              </p>
              <p className="mt-1">{event.title} · {confirmation.ticket.ticketType}</p>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">{t('orders.order')}</dt><dd className="font-mono">#{confirmation.orderId.slice(0, 8)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <dt>{t('checkout.total')}</dt>
                <dd>{formatKZT(confirmation.total)}</dd>
              </div>
              {confirmation.total === 0 && <p className="text-xs text-gray-500">{t('checkout.noPaymentNeeded')}</p>}
            </dl>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowTicket(true)} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                {t('orders.openTicket')}
              </button>
              <Link to="/tickets" onClick={close} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-center text-sm font-semibold hover:bg-gray-50">
                {t('checkout.goToOrders')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="font-semibold text-gray-800">{event.title}</p>
            <p className="mb-4 text-sm text-gray-500">{formatEventDateTime(event.startsAt, event.timezone)} · {event.venueName}</p>

            {tiers.length === 0 ? (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{t('checkout.noTiers')}</p>
            ) : (
              <fieldset className="mb-4 space-y-2">
                <legend className="mb-1 text-xs font-semibold text-gray-600">{t('checkout.ticketType')}</legend>
                {tiers.map((x) => {
                  const why = tierUnavailable(x, event);
                  return (
                    <label key={x.id} className={`flex items-center justify-between rounded-lg border p-3 text-sm ${tierId === x.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'} ${why ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                      <span className="flex items-center gap-2">
                        <input type="radio" name="tier" value={x.id} checked={tierId === x.id} disabled={Boolean(why)}
                          onChange={() => setTierId(x.id)} />
                        <span>
                          {x.name}
                          {why && <span className="block text-xs text-red-600">{t(`checkout.unavailable.${why}`)}</span>}
                        </span>
                      </span>
                      <strong>{x.priceKZT > 0 ? formatKZT(x.priceKZT) : t('common.free')}</strong>
                    </label>
                  );
                })}
                <p className="text-xs text-gray-500">{t('checkout.onePerAccount')}</p>
              </fieldset>
            )}

            {paidBlocked && (
              <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">{t('checkout.paidBlockedNote')}</p>
            )}

            {tierId && !isFree && (
              <div className="mb-4">
                <label htmlFor="promo" className="mb-1 block text-xs font-semibold text-gray-600">{t('checkout.promo')}</label>
                <div className="flex gap-2">
                  <input id="promo" type="text" value={promoInput} onChange={(e) => setPromoInput(e.target.value)}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase focus:border-blue-500 focus:outline-none" />
                  <button onClick={applyPromo} disabled={!promoInput.trim()}
                    className="rounded-md bg-gray-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50">
                    {t('checkout.apply')}
                  </button>
                </div>
                {promoMsg && <p role="status" className={`mt-1 text-xs ${promoMsg.error ? 'text-red-600' : 'text-emerald-700'}`}>{promoMsg.text}</p>}
              </div>
            )}

            {quote && tierId && (
              <dl className="mb-4 space-y-2 border-t pt-3 text-sm">
                <div className="flex justify-between text-gray-600"><dt>{t('checkout.subtotal')}</dt><dd>{formatKZT(quote.subtotal_kzt)}</dd></div>
                {quote.discount_kzt > 0 && (
                  <div className="flex justify-between font-medium text-emerald-700"><dt>{t('checkout.discount', { percent: quote.discount_percent })}</dt><dd>−{formatKZT(quote.discount_kzt)}</dd></div>
                )}
                {quote.fee_kzt > 0 && (
                  <div className="flex justify-between text-gray-600"><dt>{t('checkout.fee')}</dt><dd>{formatKZT(quote.fee_kzt)}</dd></div>
                )}
                <div className="flex justify-between border-t pt-2 text-base font-bold text-gray-900"><dt>{t('checkout.total')}</dt><dd className="text-blue-600">{formatKZT(quote.total_kzt)}</dd></div>
              </dl>
            )}

            {tierId && !isFree && (
              <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">{t('checkout.simulatedNote')}</p>
            )}

            {nothingAvailable && <p role="alert" className="mb-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{t('checkout.nothingAvailable')}</p>}
            {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <button onClick={confirm} disabled={busy || !quote || !tierId}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
              {busy ? t('checkout.processing') : isFree ? t('checkout.registerFree') : t('checkout.pay', { amount: quote ? formatKZT(quote.total_kzt) : '' })}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
