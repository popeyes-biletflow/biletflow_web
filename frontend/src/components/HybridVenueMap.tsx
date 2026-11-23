import React, { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { currentLang } from '../i18n';
import { formatKZT, type EventItem, type TicketTier } from '../services/events';
import { CheckoutModal } from './CheckoutModal';

interface HybridVenueMapProps {
  event?: EventItem;
  tiers?: TicketTier[];
  venueName?: string;
  venueAddress?: string;
  onSelectTier?: (tierId: string) => void;
}

type TabType = 'seating' | 'location' | 'sectors';

interface SeatItem {
  id: string;
  rowNumber: number;
  seatNumber: number;
  tierId: string;
  tierName: string;
  priceKZT: number;
  x: number;
  y: number;
  isOccupied: boolean;
  block: 'left' | 'center' | 'right';
}

const TIER_THEME_COLORS = [
  { fill: '#3b82f6', border: '#2563eb' }, // vibrant blue
  { fill: '#8b5cf6', border: '#7c3aed' }, // violet
  { fill: '#059669', border: '#047857' }, // emerald
  { fill: '#d97706', border: '#b45309' }, // amber
  { fill: '#db2777', border: '#be185d' }, // pink
];

export const HybridVenueMap: React.FC<HybridVenueMapProps> = ({
  event,
  tiers: propTiers,
  venueName: propVenueName,
  venueAddress: propVenueAddress,
  onSelectTier,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const baseId = useId();

  const tiers = useMemo(() => {
    return propTiers || event?.ticketTiers || [];
  }, [propTiers, event?.ticketTiers]);

  const venueName = propVenueName || event?.venueName || 'Venue';
  const venueAddress = propVenueAddress || event?.venueAddress || '';

  const [activeTab, setActiveTab] = useState<TabType>('seating');
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [hoveredSeat, setHoveredSeat] = useState<SeatItem | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutTierId, setCheckoutTierId] = useState<string>('');

  // Sort tiers by price descending (highest price in front)
  const orderedTiers = useMemo(() => {
    return [...tiers].sort((a, b) => b.priceKZT - a.priceKZT);
  }, [tiers]);

  // Color lookup per tier
  const tierColorMap = useMemo(() => {
    const map = new Map<string, { fill: string; border: string }>();
    orderedTiers.forEach((tier, idx) => {
      map.set(tier.id, TIER_THEME_COLORS[idx % TIER_THEME_COLORS.length]);
    });
    return map;
  }, [orderedTiers]);

  // Generate clean, minimalist grid of seats (Ticketon / Kino.kz style)
  const { seats, rowCount } = useMemo(() => {
    if (!orderedTiers.length) return { seats: [], rowCount: 0 };

    const totalRows = 8;
    const generated: SeatItem[] = [];

    // Helper to assign tier based on row
    const getTierForRow = (rowNum: number) => {
      if (orderedTiers.length === 1) return orderedTiers[0];
      if (orderedTiers.length === 2) {
        return rowNum <= 3 ? orderedTiers[0] : orderedTiers[1];
      }
      if (orderedTiers.length === 3) {
        if (rowNum <= 2) return orderedTiers[0];
        if (rowNum <= 5) return orderedTiers[1];
        return orderedTiers[2];
      }
      const tierIdx = Math.min(Math.floor(((rowNum - 1) / totalRows) * orderedTiers.length), orderedTiers.length - 1);
      return orderedTiers[tierIdx];
    };

    const seatWidth = 19;
    const seatHeight = 19;
    const seatGap = 6;
    const aisleGap = 20;
    const startY = 85;
    const leftMargin = 44;

    for (let r = 1; r <= totalRows; r++) {
      const y = startY + (r - 1) * (seatHeight + seatGap + 5);
      const tier = getTierForRow(r);

      // Left block: seats 1..4
      for (let s = 1; s <= 4; s++) {
        const x = leftMargin + (s - 1) * (seatWidth + seatGap);
        const isOccupied = tier.remaining !== null && tier.remaining === 0 ? true : (r * 7 + s * 3) % 5 === 0;
        generated.push({
          id: `seat-${r}-${s}`,
          rowNumber: r,
          seatNumber: s,
          tierId: tier.id,
          tierName: tier.name,
          priceKZT: tier.priceKZT,
          x,
          y,
          isOccupied,
          block: 'left',
        });
      }

      // Center block: seats 5..14
      const centerStartX = leftMargin + 4 * (seatWidth + seatGap) + aisleGap - seatGap;
      for (let s = 5; s <= 14; s++) {
        const x = centerStartX + (s - 5) * (seatWidth + seatGap);
        const isOccupied = tier.remaining !== null && tier.remaining === 0 ? true : (r * 11 + s * 2) % 6 === 0;
        generated.push({
          id: `seat-${r}-${s}`,
          rowNumber: r,
          seatNumber: s,
          tierId: tier.id,
          tierName: tier.name,
          priceKZT: tier.priceKZT,
          x,
          y,
          isOccupied,
          block: 'center',
        });
      }

      // Right block: seats 15..18
      const rightStartX = centerStartX + 10 * (seatWidth + seatGap) + aisleGap - seatGap;
      for (let s = 15; s <= 18; s++) {
        const x = rightStartX + (s - 15) * (seatWidth + seatGap);
        const isOccupied = tier.remaining !== null && tier.remaining === 0 ? true : (r * 5 + s * 7) % 5 === 0;
        generated.push({
          id: `seat-${r}-${s}`,
          rowNumber: r,
          seatNumber: s,
          tierId: tier.id,
          tierName: tier.name,
          priceKZT: tier.priceKZT,
          x,
          y,
          isOccupied,
          block: 'right',
        });
      }
    }

    return { seats: generated, rowCount: totalRows };
  }, [orderedTiers]);

  // Selected seat items
  const selectedSeats = useMemo(() => {
    return seats.filter((s) => selectedSeatIds.includes(s.id));
  }, [seats, selectedSeatIds]);

  const totalSelectedPrice = useMemo(() => {
    return selectedSeats.reduce((sum, s) => sum + s.priceKZT, 0);
  }, [selectedSeats]);

  const toggleSeatSelection = (seat: SeatItem) => {
    if (seat.isOccupied) return;
    setSelectedSeatIds((prev) => {
      const exists = prev.includes(seat.id);
      if (exists) {
        return prev.filter((id) => id !== seat.id);
      } else {
        const next = [...prev, seat.id];
        if (onSelectTier) onSelectTier(seat.tierId);
        return next;
      }
    });
  };

  // Functional Book Ticket action
  const handleBookTicket = () => {
    if (!selectedSeats.length && !orderedTiers.length) return;

    const targetTierId = selectedSeats[0]?.tierId || orderedTiers[0]?.id || '';
    if (onSelectTier) onSelectTier(targetTierId);

    if (!user) {
      navigate('/login');
      return;
    }

    if (event) {
      setCheckoutTierId(targetTierId);
      setCheckoutOpen(true);
    } else {
      // Fallback: scroll down to purchase button
      const btn = document.querySelector('button[class*="bg-emerald-600"]');
      if (btn) btn.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const mapQuery = encodeURIComponent([venueName, venueAddress].filter(Boolean).join(', '));
  const hl = currentLang() === 'en' ? 'en' : 'ru';

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/5">
      {/* Header and Minimalist Tab Navigation */}
      <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900">
            {t('hybridMap.title', { defaultValue: 'Interactive Seating Plan' })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('hybridMap.subtitle', {
              defaultValue: 'Choose your seats and view stage directions',
            })}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="mt-3 flex gap-1 sm:mt-0">
          <button
            type="button"
            onClick={() => setActiveTab('seating')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'seating'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {t('hybridMap.tabSeating', { defaultValue: 'Seating map' })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('location')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'location'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {t('hybridMap.tabLocation', { defaultValue: 'Location' })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sectors')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'sectors'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {t('hybridMap.tabSectors', { defaultValue: 'Tiers & Pricing' })}
          </button>
        </div>
      </div>

      {/* Tab 1: Minimalistic Ticketon / Kino.kz Seating Plan */}
      {activeTab === 'seating' && (
        <div className="p-4 sm:p-6">
          {/* Top Bar: Legend & Zoom Controls */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 text-xs">
            {/* Color Legend (Ticketon / Kino.kz style) */}
            <div className="flex flex-wrap items-center gap-3">
              {orderedTiers.map((tier) => {
                const colors = tierColorMap.get(tier.id) || { fill: '#3b82f6', border: '#2563eb' };
                return (
                  <div key={tier.id} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-[3px] shadow-2xs"
                      style={{ backgroundColor: colors.fill, border: `1px solid ${colors.border}` }}
                    />
                    <span className="font-medium text-gray-700">
                      {tier.name} · {formatKZT(tier.priceKZT)}
                    </span>
                  </div>
                );
              })}

              {/* Occupied legend */}
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3.5 w-3.5 rounded-[3px] bg-gray-200 border border-gray-300" />
                <span className="text-gray-500">{t('hybridMap.occupied', { defaultValue: 'Occupied' })}</span>
              </div>

              {/* Selected legend */}
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3.5 w-3.5 rounded-[3px] bg-emerald-500 border border-emerald-600" />
                <span className="font-semibold text-emerald-700">{t('hybridMap.selected', { defaultValue: 'Selected' })}</span>
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-md">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.1))}
                title={t('hybridMap.zoomIn', { defaultValue: 'Zoom in' })}
                className="h-6 w-6 flex items-center justify-center rounded bg-white text-gray-700 font-bold hover:bg-gray-50 shadow-2xs"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.85, z - 0.1))}
                title={t('hybridMap.zoomOut', { defaultValue: 'Zoom out' })}
                className="h-6 w-6 flex items-center justify-center rounded bg-white text-gray-700 font-bold hover:bg-gray-50 shadow-2xs"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                title={t('hybridMap.resetView', { defaultValue: 'Reset view' })}
                className="px-1.5 h-6 flex items-center justify-center rounded bg-white text-[11px] text-gray-600 font-medium hover:bg-gray-50 shadow-2xs"
              >
                100%
              </button>
            </div>
          </div>

          {/* Minimalist Seating Canvas */}
          <div className="relative overflow-x-auto rounded-xl bg-slate-50/50 p-4 ring-1 ring-gray-100 flex justify-center">
            <div
              className="transition-transform duration-200 ease-out origin-top min-w-[560px]"
              style={{ transform: `scale(${zoomLevel})` }}
            >
              <svg
                viewBox="0 0 560 370"
                className="w-full max-w-xl mx-auto select-none"
                role="img"
                aria-label={t('hybridMap.title')}
              >
                <defs>
                  {/* Subtle Screen / Stage Glow */}
                  <linearGradient id={`${baseId}-screen-glow`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Minimalist Curved Stage / Screen Bar (Like Kino.kz / Ticketon) */}
                <g>
                  {/* Screen trapezoid beam glow */}
                  <path
                    d="M 90 28 Q 280 10 470 28 L 500 55 Q 280 40 60 55 Z"
                    fill={`url(#${baseId}-screen-glow)`}
                  />

                  {/* Elegant Screen Arc */}
                  <path
                    d="M 80 32 Q 280 12 480 32"
                    stroke="#0284c7"
                    strokeWidth="3.5"
                    fill="none"
                    strokeLinecap="round"
                  />

                  <text
                    x="280"
                    y="24"
                    textAnchor="middle"
                    fill="#0369a1"
                    fontSize="11"
                    fontWeight="800"
                    letterSpacing="3"
                  >
                    ★ {t('hybridMap.screen', { defaultValue: 'STAGE / SCREEN' })} ★
                  </text>
                </g>

                {/* Left & Right Row Numbers */}
                {Array.from({ length: rowCount }, (_, i) => i + 1).map((r) => {
                  const y = 85 + (r - 1) * 30 + 13;
                  return (
                    <g key={`row-labels-${r}`} className="text-[10px] font-bold fill-gray-400 select-none">
                      <text x="28" y={y} textAnchor="end">{r}</text>
                      <text x="532" y={y} textAnchor="start">{r}</text>
                    </g>
                  );
                })}

                {/* Aisle Labels (Language-specific) */}
                <text x="148" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="600" letterSpacing="1">
                  {t('hybridMap.aisle', { defaultValue: 'AISLE' })}
                </text>
                <text x="412" y="75" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="600" letterSpacing="1">
                  {t('hybridMap.aisle', { defaultValue: 'AISLE' })}
                </text>

                {/* MINIMALIST SQUARE SEATS (Kino.kz / Ticketon style) */}
                {seats.map((seat) => {
                  const isSelected = selectedSeatIds.includes(seat.id);
                  const isHovered = hoveredSeat?.id === seat.id;
                  const colors = tierColorMap.get(seat.tierId) || { fill: '#3b82f6', border: '#2563eb' };

                  let fill = colors.fill;
                  let stroke = colors.border;
                  let strokeWidth = 1;
                  let opacity = 0.95;

                  if (seat.isOccupied) {
                    fill = '#e2e8f0';
                    stroke = '#cbd5e1';
                    opacity = 0.8;
                  } else if (isSelected) {
                    fill = '#10b981'; // emerald green like Ticketon active selection
                    stroke = '#047857';
                    strokeWidth = 2;
                    opacity = 1;
                  } else if (isHovered) {
                    stroke = '#1e293b';
                    strokeWidth = 2;
                    opacity = 1;
                  }

                  return (
                    <g
                      key={seat.id}
                      className={seat.isOccupied ? 'cursor-not-allowed' : 'cursor-pointer'}
                      onClick={() => toggleSeatSelection(seat)}
                      onMouseEnter={() => setHoveredSeat(seat)}
                      onMouseLeave={() => setHoveredSeat(null)}
                      tabIndex={seat.isOccupied ? -1 : 0}
                      role="button"
                      aria-label={`${t('hybridMap.row', { row: seat.rowNumber })}, ${t('hybridMap.seat', { seat: seat.seatNumber })}: ${formatKZT(seat.priceKZT)}`}
                      aria-pressed={isSelected}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          toggleSeatSelection(seat);
                        }
                      }}
                    >
                      {/* Seat Rounded Square */}
                      <rect
                        x={seat.x}
                        y={seat.y}
                        width="19"
                        height="19"
                        rx="4"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        opacity={opacity}
                        className="transition-all duration-100 ease-out"
                      />

                      {/* Seat Number label inside the seat */}
                      <text
                        x={seat.x + 9.5}
                        y={seat.y + 12.5}
                        textAnchor="middle"
                        fill={seat.isOccupied ? '#94a3b8' : '#ffffff'}
                        fontSize="8.5"
                        fontWeight="700"
                        className="pointer-events-none select-none"
                      >
                        {seat.seatNumber}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Ticketon-style Floating / Bottom Purchase Summary Bar */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            {selectedSeats.length > 0 ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    {t('hybridMap.selected', { defaultValue: 'Selected' })} ({selectedSeats.length}):
                  </span>
                  {selectedSeats.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200"
                    >
                      <span>
                        {t('hybridMap.row', { row: s.rowNumber, defaultValue: `Row ${s.rowNumber}` })},{' '}
                        {t('hybridMap.seat', { seat: s.seatNumber, defaultValue: `Seat ${s.seatNumber}` })}
                      </span>
                      <span className="text-emerald-600 font-normal">({formatKZT(s.priceKZT)})</span>
                      <button
                        type="button"
                        onClick={() => toggleSeatSelection(s)}
                        className="ml-0.5 text-emerald-600 hover:text-emerald-900 font-bold"
                        title={t('hybridMap.clear', { defaultValue: 'Remove seat' })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedSeatIds([])}
                    className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
                  >
                    {t('hybridMap.clear', { defaultValue: 'Clear' })}
                  </button>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0">
                  <div className="text-right">
                    <span className="block text-[10px] uppercase font-bold text-gray-400">
                      {t('hybridMap.total', { defaultValue: 'Total' })}:
                    </span>
                    <span className="text-base font-black text-gray-900">
                      {formatKZT(totalSelectedPrice)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleBookTicket}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition flex items-center gap-1.5"
                  >
                    <span>{user ? t('hybridMap.bookSeats', { defaultValue: 'Book ticket' }) : t('hybridMap.loginToBook', { defaultValue: 'Sign in to buy' })}</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ) : hoveredSeat ? (
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tierColorMap.get(hoveredSeat.tierId)?.fill || '#3b82f6' }} />
                <span className="font-bold">{hoveredSeat.tierName}</span> ·{' '}
                <span>{t('hybridMap.row', { row: hoveredSeat.rowNumber, defaultValue: `Row ${hoveredSeat.rowNumber}` })}, {t('hybridMap.seat', { seat: hoveredSeat.seatNumber, defaultValue: `Seat ${hoveredSeat.seatNumber}` })}</span> ·{' '}
                <span className="font-semibold text-gray-900">{formatKZT(hoveredSeat.priceKZT)}</span>
                <span className="text-gray-400 ml-2">
                  ({hoveredSeat.isOccupied ? t('hybridMap.occupied', { defaultValue: 'Occupied' }) : t('hybridMap.clickToSelect', { defaultValue: 'Click to select' })})
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>👆</span>
                <span>
                  {t('hybridMap.hint', {
                    defaultValue: 'Click an available seat on the seating plan to select it.',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Location & Transit (Google / Yandex Maps) */}
      {activeTab === 'location' && (
        <div className="p-5">
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-xs">
            <iframe
              title={t('map.iframeTitle', { venue: venueName || venueAddress, defaultValue: `Map showing ${venueName}` })}
              src={`https://maps.google.com/maps?q=${mapQuery}&hl=${hl}&z=15&output=embed`}
              className="h-80 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-xs">
              <span className="font-medium text-gray-700">
                📍 {venueName} — {venueAddress}
              </span>
              <div className="flex gap-3">
                <a
                  className="font-semibold text-blue-600 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                >
                  {t('map.openGoogle', { defaultValue: 'Open in Google Maps' })} →
                </a>
                <a
                  className="font-semibold text-blue-600 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://yandex.kz/maps/?text=${mapQuery}`}
                >
                  {t('map.openYandex', { defaultValue: 'Open in Yandex Maps' })} →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Tiers & Pricing Breakdown */}
      {activeTab === 'sectors' && (
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">{t('hybridMap.tableSector', { defaultValue: 'Tier / Sector' })}</th>
                  <th className="py-3 px-4">{t('hybridMap.tablePrice', { defaultValue: 'Price' })}</th>
                  <th className="py-3 px-4">{t('hybridMap.tableRows', { defaultValue: 'Rows' })}</th>
                  <th className="py-3 px-4 text-right">{t('hybridMap.tableStatus', { defaultValue: 'Status' })}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orderedTiers.map((tier, idx) => {
                  const colors = tierColorMap.get(tier.id) || { fill: '#3b82f6', border: '#2563eb' };
                  const isSold = tier.remaining !== null && tier.remaining === 0;
                  const rowRange =
                    idx === 0
                      ? t('hybridMap.rowsVip', { defaultValue: 'Rows 1–2 (VIP)' })
                      : idx === 1
                      ? t('hybridMap.rowsMid', { defaultValue: 'Rows 3–5' })
                      : t('hybridMap.rowsBack', { defaultValue: 'Rows 6–8' });

                  return (
                    <tr key={tier.id} className="hover:bg-gray-50/70 transition">
                      <td className="py-3.5 px-4 font-semibold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="h-3.5 w-3.5 rounded-[3px]" style={{ backgroundColor: colors.fill }} />
                          <span>{tier.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-gray-900">
                        {tier.priceKZT > 0 ? formatKZT(tier.priceKZT) : t('common.free', { defaultValue: 'Free' })}
                      </td>
                      <td className="py-3.5 px-4 text-gray-600">{rowRange}</td>
                      <td className="py-3.5 px-4 text-right">
                        {isSold ? (
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                            {t('details.soldOut', { defaultValue: 'Sold out' })}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            {tier.remaining !== null
                              ? t('details.left', { count: tier.remaining, defaultValue: `${tier.remaining} left` })
                              : t('hybridMap.available', { defaultValue: 'Available' })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Embedded CheckoutModal triggered directly from the Seating Plan */}
      {event && (
        <CheckoutModal
          isOpen={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          event={event}
          initialTierId={checkoutTierId}
        />
      )}
    </section>
  );
};
