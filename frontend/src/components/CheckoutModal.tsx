import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { TicketPDF, type TicketDetails } from './TicketPDF';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventTitle?: string;
  basePriceKZT?: number;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  eventTitle = 'BiletFlow Tech Conference 2026',
  basePriceKZT = 15000,
}) => {
  const { user } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const [promoCode, setPromoCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [promoStatus, setPromoStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [purchasedTicket, setPurchasedTicket] = useState<TicketDetails | null>(null);

  if (!isOpen) return null;

  const handleApplyPromo = () => {
    const code = promoCode.trim().toUpperCase();
    if (code === 'BILET10') {
      setDiscountPercent(10);
      setPromoStatus({ message: 'Промокод применен! Скидка 10%', isError: false });
    } else if (code === 'PROMO20') {
      setDiscountPercent(20);
      setPromoStatus({ message: 'Промокод применен! Скидка 20%', isError: false });
    } else {
      setDiscountPercent(0);
      setPromoStatus({ message: 'Недействительный промокод', isError: true });
    }
  };

  const rawTotal = basePriceKZT * quantity;
  const discountAmount = Math.round((rawTotal * discountPercent) / 100);
  const finalTotal = rawTotal - discountAmount;

  const handleSimulatePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setPurchasedTicket({
        ticketId: 'TKT-' + Math.floor(100000 + Math.random() * 900000),
        eventName: eventTitle,
        eventDate: '15 Ноября 2026, 19:00',
        venue: 'Astana IT Hub, Астана',
        attendeeName: user?.name || 'Гость',
        attendeeEmail: user?.email || 'guest@example.com',
        ticketType: 'Standard Entry',
        priceKZT: rawTotal,
        discountKZT: discountAmount,
        totalKZT: finalTotal,
      });
    }, 1200);
  };

  if (purchasedTicket) {
    return <TicketPDF ticket={purchasedTicket} onClose={() => { setPurchasedTicket(null); onClose(); }} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex justify-between items-center border-b pb-3 mb-4">
          <h3 className="text-xl font-bold text-gray-800">Оформление заказа</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">
            &times;
          </button>
        </div>

        <p className="font-semibold text-gray-700 mb-4">{eventTitle}</p>

        <div className="flex items-center justify-between mb-4 bg-gray-50 p-3 rounded-lg">
          <span className="text-sm font-medium text-gray-600">Количество (KZT {basePriceKZT.toLocaleString()} / шт):</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-8 w-8 rounded border bg-white font-bold text-gray-600 hover:bg-gray-100"
            >
              -
            </button>
            <span className="w-6 text-center font-bold text-gray-800">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="h-8 w-8 rounded border bg-white font-bold text-gray-600 hover:bg-gray-100"
            >
              +
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-gray-600">Промокод</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Введи BILET10"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleApplyPromo}
              className="rounded-md bg-gray-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-900"
            >
              Применить
            </button>
          </div>
          {promoStatus && (
            <p className={`mt-1 text-xs ${promoStatus.isError ? 'text-red-500' : 'text-emerald-600'}`}>
              {promoStatus.message}
            </p>
          )}
        </div>

        <div className="space-y-2 border-t pt-3 mb-6 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Сумма:</span>
            <span>{rawTotal.toLocaleString()} KZT</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between text-emerald-600 font-medium">
              <span>Скидка ({discountPercent}%):</span>
              <span>-{discountAmount.toLocaleString()} KZT</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base text-gray-900 border-t pt-2">
            <span>Итого к оплате:</span>
            <span className="text-blue-600">{finalTotal.toLocaleString()} KZT</span>
          </div>
        </div>

        <button
          onClick={handleSimulatePayment}
          disabled={isProcessing}
          className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isProcessing ? 'Обработка оплаты...' : `Оплатить ${finalTotal.toLocaleString()} KZT`}
        </button>
      </div>
    </div>
  );
};