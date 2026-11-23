import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLang } from '../i18n';
import { formatKZT, type EventItem, type TicketTier } from '../services/events';

interface HybridVenueMapProps {
  event?: EventItem;
  tiers?: TicketTier[];
  venueName?: string;
  venueAddress?: string;
  onSelectTier?: (tierId: string) => void;
}

type TabType = 'seating' | 'location' | 'sectors';

interface SeatInfo {
  id: string;
  sectionId: string;
  sectionName: string;
  row: string;
  seatNumber: number;
  tierId: string;
  tierName: string;
  priceKZT: number;
  cx: number;
  cy: number;
  status: 'available' | 'sold';
  gate: string;
  sightline: string;
}

const TIER_COLORS = [
  '#2563eb', // blue
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
];

export const HybridVenueMap: React.FC<HybridVenueMapProps> = ({
  event,
  tiers: propTiers,
  venueName: propVenueName,
  venueAddress: propVenueAddress,
  onSelectTier,
}) => {
  const { t } = useTranslation();
  const baseId = useId();

  const tiers = useMemo(() => {
    return propTiers || event?.ticketTiers || [];
  }, [propTiers, event?.ticketTiers]);

  const venueName = propVenueName || event?.venueName || 'Venue';
  const venueAddress = propVenueAddress || event?.venueAddress || '';

  const [activeTab, setActiveTab] = useState<TabType>('seating');
  const [filterTierId, setFilterTierId] = useState<string>('all');
  const [selectedSeat, setSelectedSeat] = useState<SeatInfo | null>(null);
  const [hoveredSeat, setHoveredSeat] = useState<SeatInfo | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // Sort tiers by price descending
  const orderedTiers = useMemo(() => {
    return [...tiers].sort((a, b) => b.priceKZT - a.priceKZT);
  }, [tiers]);

  // Generate realistic seats mapped to the event tiers
  const seats = useMemo(() => {
    if (!orderedTiers.length) return [];
    const generated: SeatInfo[] = [];

    // Helper to get tier by index or fallback to first
    const getTier = (index: number) => {
      return orderedTiers[index % orderedTiers.length];
    };

    // VIP Front Rows (Closest to stage: cy 140..170, cx 160..340)
    const vipTier = getTier(0);
    const vipRows = ['VIP-A', 'VIP-B'];
    vipRows.forEach((rowName, rIdx) => {
      const y = 145 + rIdx * 20;
      for (let s = 1; s <= 12; s++) {
        const x = 165 + (s - 1) * 15.5;
        // Deterministically make some seats sold if tier remaining is limited
        const isSold = vipTier.remaining !== null && vipTier.remaining === 0 ? true : (s * 7 + rIdx * 3) % 9 === 0;
        generated.push({
          id: `vip-${rIdx}-${s}`,
          sectionId: 'vip',
          sectionName: `${vipTier.name} (Front Row)`,
          row: rowName,
          seatNumber: s,
          tierId: vipTier.id,
          tierName: vipTier.name,
          priceKZT: vipTier.priceKZT,
          cx: x,
          cy: y,
          status: isSold ? 'sold' : 'available',
          gate: 'Gate A (VIP & Fast-Track)',
          sightline: '100% Unobstructed Stage Frontline View',
        });
      }
    });

    // Lower Bowl Center (cy 220..270, cx 150..350)
    const midTier = getTier(orderedTiers.length > 1 ? 1 : 0);
    const centerRows = ['Row 1', 'Row 2', 'Row 3', 'Row 4'];
    centerRows.forEach((rowName, rIdx) => {
      const y = 220 + rIdx * 18;
      for (let s = 1; s <= 14; s++) {
        const x = 150 + (s - 1) * 15.5;
        const isSold = midTier.remaining !== null && midTier.remaining === 0 ? true : (s * 5 + rIdx * 4) % 11 === 0;
        generated.push({
          id: `center-${rIdx}-${s}`,
          sectionId: 'center',
          sectionName: `${midTier.name} (Center Orchestra)`,
          row: rowName,
          seatNumber: s,
          tierId: midTier.id,
          tierName: midTier.name,
          priceKZT: midTier.priceKZT,
          cx: x,
          cy: y,
          status: isSold ? 'sold' : 'available',
          gate: 'Gate B (Main Concourse)',
          sightline: 'Direct Stage Center Sightline',
        });
      }
    });

    // Lower Left Sector (Angled)
    const leftTier = getTier(orderedTiers.length > 2 ? 2 : 0);
    const leftRows = ['L-A', 'L-B', 'L-C'];
    leftRows.forEach((rowName, rIdx) => {
      for (let s = 1; s <= 8; s++) {
        const x = 45 + (s - 1) * 12 + rIdx * 6;
        const y = 170 + (s - 1) * 11 + rIdx * 18;
        const isSold = leftTier.remaining !== null && leftTier.remaining === 0 ? true : (s * 3 + rIdx) % 8 === 0;
        generated.push({
          id: `left-${rIdx}-${s}`,
          sectionId: 'left',
          sectionName: `${leftTier.name} (West Wing)`,
          row: rowName,
          seatNumber: s,
          tierId: leftTier.id,
          tierName: leftTier.name,
          priceKZT: leftTier.priceKZT,
          cx: x,
          cy: y,
          status: isSold ? 'sold' : 'available',
          gate: 'Gate C (West Concourse)',
          sightline: 'West Elevated View of Stage & Screen',
        });
      }
    });

    // Lower Right Sector (Angled)
    const rightTier = getTier(orderedTiers.length > 2 ? 2 : 0);
    const rightRows = ['R-A', 'R-B', 'R-C'];
    rightRows.forEach((rowName, rIdx) => {
      for (let s = 1; s <= 8; s++) {
        const x = 365 + (s - 1) * 12 - rIdx * 6;
        const y = 255 - (s - 1) * 11 + rIdx * 18;
        const isSold = rightTier.remaining !== null && rightTier.remaining === 0 ? true : (s * 4 + rIdx) % 8 === 0;
        generated.push({
          id: `right-${rIdx}-${s}`,
          sectionId: 'right',
          sectionName: `${rightTier.name} (East Wing)`,
          row: rowName,
          seatNumber: s,
          tierId: rightTier.id,
          tierName: rightTier.name,
          priceKZT: rightTier.priceKZT,
          cx: x,
          cy: y,
          status: isSold ? 'sold' : 'available',
          gate: 'Gate D (East Concourse)',
          sightline: 'East Elevated View of Stage & Screen',
        });
      }
    });

    // Upper Balcony (cy 325..360, cx 110..390)
    const balconyTier = getTier(orderedTiers.length - 1);
    const balconyRows = ['Balcony-1', 'Balcony-2'];
    balconyRows.forEach((rowName, rIdx) => {
      const y = 325 + rIdx * 20;
      for (let s = 1; s <= 20; s++) {
        const x = 100 + (s - 1) * 15.8;
        const isSold = balconyTier.remaining !== null && balconyTier.remaining === 0 ? true : (s * 3 + rIdx * 2) % 6 === 0;
        generated.push({
          id: `balcony-${rIdx}-${s}`,
          sectionId: 'balcony',
          sectionName: `${balconyTier.name} (Upper Balcony)`,
          row: rowName,
          seatNumber: s,
          tierId: balconyTier.id,
          tierName: balconyTier.name,
          priceKZT: balconyTier.priceKZT,
          cx: x,
          cy: y,
          status: isSold ? 'sold' : 'available',
          gate: 'Gate B / Stairs 2 (Upper Level)',
          sightline: 'Panoramic Arena Overview',
        });
      }
    });

    return generated;
  }, [orderedTiers]);

  // Color lookup per tier
  const tierColorMap = useMemo(() => {
    const map = new Map<string, string>();
    orderedTiers.forEach((tier, idx) => {
      map.set(tier.id, TIER_COLORS[idx % TIER_COLORS.length]);
    });
    return map;
  }, [orderedTiers]);

  // Query for maps
  const mapQuery = encodeURIComponent([venueName, venueAddress].filter(Boolean).join(', '));
  const hl = currentLang() === 'en' ? 'en' : 'ru';

  const activeInspector = hoveredSeat || selectedSeat;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/5">
      {/* Header and Hybrid View Tabs */}
      <div className="border-b border-gray-100 bg-gray-50/70 p-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              🏟️
            </span>
            <h3 className="text-lg font-bold text-gray-900">
              {t('hybridMap.title', { defaultValue: 'Hybrid Interactive Venue Map' })}
            </h3>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-gray-500">
            {t('hybridMap.subtitle', {
              defaultValue: 'Explore seating tiers, realistic stage sightlines, and venue entrance points',
            })}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-0">
          <button
            type="button"
            onClick={() => setActiveTab('seating')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === 'seating'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>🏟️</span>
            <span>{t('hybridMap.tabSeating', { defaultValue: 'Seating & Stage' })}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('location')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === 'location'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>📍</span>
            <span>{t('hybridMap.tabLocation', { defaultValue: 'Location & Transit' })}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sectors')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === 'sectors'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>🎟️</span>
            <span>{t('hybridMap.tabSectors', { defaultValue: 'Sectors & Perks' })}</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Interactive Seating & Stage Layout */}
      {activeTab === 'seating' && (
        <div className="p-5">
          {/* Controls toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
            {/* Tier Filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-gray-500 mr-1">
                {t('seating.legend', { defaultValue: 'Filter by Tier:' })}
              </span>
              <button
                type="button"
                onClick={() => setFilterTierId('all')}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  filterTierId === 'all'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t('hybridMap.filterAll', { defaultValue: 'All Sections' })}
              </button>
              {orderedTiers.map((tier) => {
                const isSelected = filterTierId === tier.id;
                const color = tierColorMap.get(tier.id) || '#2563eb';
                return (
                  <button
                    key={tier.id}
                    type="button"
                    onClick={() => setFilterTierId(isSelected ? 'all' : tier.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isSelected
                        ? 'text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    style={isSelected ? { backgroundColor: color } : undefined}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span>{tier.name}</span>
                    <span className="opacity-80">({formatKZT(tier.priceKZT)})</span>
                  </button>
                );
              })}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(1.5, z + 0.15))}
                title={t('hybridMap.zoomIn', { defaultValue: 'Zoom in' })}
                className="h-7 w-7 flex items-center justify-center rounded bg-white text-gray-700 font-bold hover:bg-gray-50 shadow-xs"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.85, z - 0.15))}
                title={t('hybridMap.zoomOut', { defaultValue: 'Zoom out' })}
                className="h-7 w-7 flex items-center justify-center rounded bg-white text-gray-700 font-bold hover:bg-gray-50 shadow-xs"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                title={t('hybridMap.resetView', { defaultValue: 'Reset view' })}
                className="px-2 h-7 flex items-center justify-center rounded bg-white text-xs text-gray-700 font-semibold hover:bg-gray-50 shadow-xs"
              >
                100%
              </button>
            </div>
          </div>

          {/* SVG Venue Map Canvas */}
          <div className="relative overflow-hidden rounded-xl bg-slate-950 p-4 ring-1 ring-slate-800">
            {/* Stage Lighting Backdrop glow */}
            <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-96 -translate-x-1/2 bg-blue-600/15 blur-3xl" />

            <div
              className="flex justify-center transition-transform duration-300 ease-out origin-top"
              style={{ transform: `scale(${zoomLevel})` }}
            >
              <svg
                viewBox="0 0 500 420"
                className="w-full max-w-2xl select-none"
                role="img"
                aria-label={t('hybridMap.title')}
              >
                <defs>
                  {/* Stage Glow Gradient */}
                  <linearGradient id={`${baseId}-stage-glow`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.4" />
                  </linearGradient>

                  {/* Standing Pit Floor Gradient */}
                  <linearGradient id={`${baseId}-pit`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#1e293b" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
                  </linearGradient>
                </defs>

                {/* Arena Outer Boundary */}
                <rect
                  x="15"
                  y="15"
                  width="470"
                  height="390"
                  rx="30"
                  fill="#090d16"
                  stroke="#1e293b"
                  strokeWidth="2"
                />

                {/* Venue Gates and Facility Markers */}
                <g className="text-[9px] fill-slate-400 font-medium">
                  {/* Gate A (Top Left) */}
                  <rect x="25" y="25" width="70" height="20" rx="4" fill="#1e293b" />
                  <text x="60" y="38" textAnchor="middle" fill="#94a3b8">🚪 Gate A (VIP)</text>

                  {/* Gate D (Top Right) */}
                  <rect x="405" y="25" width="70" height="20" rx="4" fill="#1e293b" />
                  <text x="440" y="38" textAnchor="middle" fill="#94a3b8">🚪 Gate D (East)</text>

                  {/* Gate B & C (Bottom Center) */}
                  <rect x="200" y="385" width="100" height="16" rx="4" fill="#1e293b" />
                  <text x="250" y="396" textAnchor="middle" fill="#94a3b8">🚪 Gates B & C (Main)</text>

                  {/* Amenities */}
                  <text x="40" y="396" fill="#64748b">🚻 Restrooms</text>
                  <text x="410" y="396" fill="#64748b">🍿 Concessions</text>
                  <text x="40" y="100" fill="#64748b">♿ Accessible</text>
                  <text x="420" y="100" fill="#64748b">ℹ️ First Aid</text>
                </g>

                {/* MAIN STAGE */}
                <g>
                  {/* Stage Lighting Beams */}
                  <path d="M 170 85 L 120 180 L 380 180 L 330 85 Z" fill="#3b82f6" fillOpacity="0.05" />

                  {/* Stage Base */}
                  <path
                    d="M 160 55 C 210 40, 290 40, 340 55 L 350 85 C 290 75, 210 75, 150 85 Z"
                    fill={`url(#${baseId}-stage-glow)`}
                    stroke="#60a5fa"
                    strokeWidth="2"
                  />
                  <rect x="180" y="60" width="140" height="26" rx="6" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" />
                  <text
                    x="250"
                    y="77"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="800"
                    letterSpacing="3"
                  >
                    ★ {t('seating.stage', { defaultValue: 'STAGE' })} ★
                  </text>

                  {/* Speakers / Monitor Arrays */}
                  <rect x="135" y="68" width="12" height="18" rx="2" fill="#334155" />
                  <rect x="353" y="68" width="12" height="18" rx="2" fill="#334155" />
                </g>

                {/* General Admission / Fan Zone Standing Floor */}
                <g>
                  <rect
                    x="150"
                    y="100"
                    width="200"
                    height="32"
                    rx="6"
                    fill={`url(#${baseId}-pit)`}
                    stroke="#334155"
                    strokeDasharray="4 4"
                  />
                  <text
                    x="250"
                    y="120"
                    textAnchor="middle"
                    fill="#cbd5e1"
                    fontSize="10"
                    fontWeight="600"
                    letterSpacing="1"
                  >
                    🔥 FAN PIT / STANDING ZONE
                  </text>
                </g>

                {/* Section Backdrop Outlines */}
                {/* VIP Sector Box */}
                <rect
                  x="150"
                  y="136"
                  width="200"
                  height="50"
                  rx="6"
                  fill="#1e1b4b"
                  fillOpacity="0.3"
                  stroke="#4338ca"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />

                {/* Center Lower Orchestra Box */}
                <rect
                  x="140"
                  y="208"
                  width="220"
                  height="88"
                  rx="8"
                  fill="#0f172a"
                  fillOpacity="0.5"
                  stroke="#1e293b"
                  strokeWidth="1"
                />

                {/* Balcony Curved Arc Outline */}
                <path
                  d="M 85 315 C 190 300, 310 300, 415 315 L 420 370 C 310 355, 190 355, 80 370 Z"
                  fill="#0f172a"
                  fillOpacity="0.6"
                  stroke="#334155"
                  strokeWidth="1"
                />

                {/* Sound Control Booth */}
                <rect x="230" y="300" width="40" height="14" rx="3" fill="#1e293b" stroke="#475569" strokeWidth="1" />
                <text x="250" y="310" textAnchor="middle" fill="#64748b" fontSize="7" fontWeight="bold">
                  🎛️ FOH MIX
                </text>

                {/* RENDER INDIVIDUAL INTERACTIVE SEATS */}
                {seats.map((seat) => {
                  const isFiltered = filterTierId === 'all' || filterTierId === seat.tierId;
                  const isSelected = selectedSeat?.id === seat.id;
                  const isHovered = hoveredSeat?.id === seat.id;
                  const tierColor = tierColorMap.get(seat.tierId) || '#3b82f6';
                  const isSold = seat.status === 'sold';

                  let fill = tierColor;
                  let stroke = '#0f172a';
                  let strokeWidth = 1;
                  let opacity = isFiltered ? 0.95 : 0.2;

                  if (isSold) {
                    fill = '#475569';
                    opacity = isFiltered ? 0.45 : 0.15;
                  }

                  if (isSelected) {
                    fill = '#ffffff';
                    stroke = '#2563eb';
                    strokeWidth = 3;
                    opacity = 1;
                  } else if (isHovered) {
                    stroke = '#ffffff';
                    strokeWidth = 2;
                    opacity = 1;
                  }

                  return (
                    <circle
                      key={seat.id}
                      cx={seat.cx}
                      cy={seat.cy}
                      r={isSelected ? 5.5 : isHovered ? 5 : 4}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      opacity={opacity}
                      className="cursor-pointer transition-all duration-150 ease-out focus:outline-none"
                      tabIndex={isSold ? -1 : 0}
                      role="button"
                      aria-label={`${seat.sectionName}, ${seat.row}, Seat ${seat.seatNumber}: ${formatKZT(seat.priceKZT)}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        if (!isSold) {
                          setSelectedSeat(isSelected ? null : seat);
                          if (onSelectTier) onSelectTier(seat.tierId);
                        }
                      }}
                      onMouseEnter={() => setHoveredSeat(seat)}
                      onMouseLeave={() => setHoveredSeat(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (!isSold) {
                            setSelectedSeat(isSelected ? null : seat);
                            if (onSelectTier) onSelectTier(seat.tierId);
                          }
                        }
                      }}
                    >
                      <title>{`${seat.sectionName} · ${seat.row} Seat ${seat.seatNumber} (${formatKZT(seat.priceKZT)}) - ${seat.status}`}</title>
                    </circle>
                  );
                })}
              </svg>
            </div>

            {/* Stage Direction Compass Indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 text-[11px] font-medium text-slate-300 backdrop-blur-md">
              <span className="text-blue-400">▲</span> {t('seating.stage', { defaultValue: 'Stage Front' })}
            </div>
          </div>

          {/* Dynamic Seat & Sector Inspector Panel */}
          <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
            {activeInspector ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: tierColorMap.get(activeInspector.tierId) || '#2563eb' }}
                    />
                    <h4 className="font-bold text-gray-900">
                      {activeInspector.sectionName} · {activeInspector.row}, Seat {activeInspector.seatNumber}
                    </h4>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        activeInspector.status === 'available'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {activeInspector.status === 'available'
                        ? t('hybridMap.available', { defaultValue: 'Available' })
                        : t('hybridMap.soldOut', { defaultValue: 'Sold Out' })}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-gray-600">
                    <span className="font-medium text-gray-800">
                      {formatKZT(activeInspector.priceKZT)}
                    </span>{' '}
                    · {activeInspector.sightline} · {activeInspector.gate}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {selectedSeat && (
                    <button
                      type="button"
                      onClick={() => setSelectedSeat(null)}
                      className="text-xs text-gray-500 hover:text-gray-800 underline"
                    >
                      {t('discovery.clear', { defaultValue: 'Clear selection' })}
                    </button>
                  )}
                  {activeInspector.status === 'available' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSeat(activeInspector);
                        if (onSelectTier) onSelectTier(activeInspector.tierId);
                      }}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition"
                    >
                      {t('hybridMap.selectThisTier', { defaultValue: 'Select this Seat' })}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="text-base">👆</span>
                <span>
                  {t('seating.hint', {
                    defaultValue: 'Hover over or click any seat or sector on the map to inspect prices and sightlines.',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Location, Transit & Entry Gates */}
      {activeTab === 'location' && (
        <div className="p-5">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Embedded Interactive Map */}
            <div className="lg:col-span-2 overflow-hidden rounded-xl border border-gray-200 shadow-xs">
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

            {/* Arrival, Transit & Gate Guide */}
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  🚪 {t('hybridMap.gates', { defaultValue: 'Entry Gates Guide' })}
                </h4>
                <ul className="space-y-2 text-xs text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-blue-600">Gate A:</span>
                    <span>VIP, Platinum Pass, & Artists (North Entry)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-emerald-600">Gates B & C:</span>
                    <span>General Admission & Fan Zone Concourse</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-purple-600">Gate D:</span>
                    <span>Accessible barrier-free & Wheelchair ramp</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  🚌 {t('hybridMap.transit', { defaultValue: 'Transit & Parking' })}
                </h4>
                <ul className="space-y-2 text-xs text-gray-600">
                  <li>🅿️ {t('hybridMap.parkingInfo', { defaultValue: 'On-site underground and surface parking available.' })}</li>
                  <li>🚍 {t('hybridMap.busInfo', { defaultValue: 'Direct bus stops within 200m of the main entrance.' })}</li>
                  <li>♿ {t('hybridMap.accessibleNotice', { defaultValue: 'Designated wheelchair spaces with barrier-free elevator access.' })}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Sectors, Pricing & Perks Comparison */}
      {activeTab === 'sectors' && (
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Tier & Section</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Distance to Stage</th>
                  <th className="py-3 px-4">Sightline Quality</th>
                  <th className="py-3 px-4">Included Perks</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orderedTiers.map((tier, idx) => {
                  const color = tierColorMap.get(tier.id) || '#2563eb';
                  const isSold = tier.remaining !== null && tier.remaining === 0;

                  // Dynamic perks based on tier order
                  const perks =
                    idx === 0
                      ? '⭐ Fast-track entry, VIP lounge, welcome drink, closest stage view'
                      : idx === 1
                      ? '✨ Optimal frontal sound, padded seats, express concessions'
                      : '🎵 Unreserved arena seating / standing, general concourse access';

                  const distance =
                    idx === 0
                      ? t('hybridMap.close', { defaultValue: 'Close (~5-15m)' })
                      : idx === 1
                      ? t('hybridMap.medium', { defaultValue: 'Medium (~15-35m)' })
                      : t('hybridMap.panoramic', { defaultValue: 'Panoramic (~35-60m)' });

                  return (
                    <tr key={tier.id} className="hover:bg-gray-50/70 transition">
                      <td className="py-3.5 px-4 font-semibold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                          <span>{tier.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-gray-900">
                        {tier.priceKZT > 0 ? formatKZT(tier.priceKZT) : t('common.free', { defaultValue: 'Free' })}
                      </td>
                      <td className="py-3.5 px-4 text-gray-600">{distance}</td>
                      <td className="py-3.5 px-4 text-gray-600">
                        <span className="text-amber-500">★★★★★</span> (
                        {idx === 0 ? '100% Direct' : idx === 1 ? '95% Center' : '90% Wide'})
                      </td>
                      <td className="py-3.5 px-4 text-gray-600 max-w-xs">{perks}</td>
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
    </section>
  );
};
