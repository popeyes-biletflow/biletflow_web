import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketTier } from '../services/events';
import { formatKZT } from '../services/events';

const COLORS = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2'];

// Annular sector between radii r0..r1 spanning `start`..`end` degrees (0 = straight down from the stage).
function arc(cx: number, cy: number, r0: number, r1: number, start: number, end: number) {
  const p = (r: number, a: number) => {
    const rad = ((a + 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(1)} ${(cy + r * Math.sin(rad)).toFixed(1)}`;
  };
  const large = end - start > 180 ? 1 : 0;
  return `M ${p(r1, start)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, end)} L ${p(r0, end)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, start)} Z`;
}

// Interactive SVG seating chart: most expensive tier sits closest to the stage.
export function SeatingLayout({ tiers }: { tiers: TicketTier[] }) {
  const { t } = useTranslation();
  const ordered = [...tiers].sort((a, b) => b.priceKZT - a.priceKZT);
  const [active, setActive] = useState<string | null>(null);
  if (!ordered.length) return null;

  const cx = 200, cy = 40, inner = 60, band = Math.min(48, 200 / ordered.length);
  const selected = ordered.find((x) => x.id === active);

  return (
    <section className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-3 font-semibold">{t('seating.title')}</h3>
      <svg viewBox={`0 0 400 ${cy + inner + band * ordered.length + 20}`} className="w-full max-w-xl" role="img" aria-label={t('seating.title')}>
        <rect x={cx - 70} y={cy - 28} width={140} height={28} rx={6} fill="#111827" />
        <text x={cx} y={cy - 9} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700" letterSpacing="2">{t('seating.stage')}</text>
        {ordered.map((tier, i) => {
          const color = COLORS[i % COLORS.length];
          const soldOut = tier.remaining === 0;
          const on = active === tier.id;
          return (
            <path key={tier.id}
              d={arc(cx, cy, inner + i * band + 3, inner + (i + 1) * band, -70, 70)}
              fill={soldOut ? '#d1d5db' : color}
              fillOpacity={active && !on ? 0.35 : 0.9}
              stroke={on ? '#111827' : '#fff'} strokeWidth={on ? 2.5 : 1.5}
              className="cursor-pointer transition-all"
              tabIndex={0} role="button"
              aria-label={`${tier.name}: ${formatKZT(tier.priceKZT)}`}
              aria-pressed={on}
              onClick={() => setActive(on ? null : tier.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActive(on ? null : tier.id)}
              onMouseEnter={() => setActive(tier.id)}>
              <title>{`${tier.name} — ${formatKZT(tier.priceKZT)}`}</title>
            </path>
          );
        })}
      </svg>

      <p className="mt-2 min-h-6 text-sm font-medium" aria-live="polite">
        {selected ? t('seating.selected', { tier: selected.name, price: formatKZT(selected.priceKZT) }) : t('seating.hint')}
      </p>

      <ul className="mt-3 flex flex-wrap gap-3 text-sm" aria-label={t('seating.legend')}>
        {ordered.map((tier, i) => (
          <li key={tier.id} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: tier.remaining === 0 ? '#d1d5db' : COLORS[i % COLORS.length] }} />
            {tier.name} · {formatKZT(tier.priceKZT)}{tier.remaining === 0 && ` (${t('details.soldOut')})`}
          </li>
        ))}
      </ul>
    </section>
  );
}
