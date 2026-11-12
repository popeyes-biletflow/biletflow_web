import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../../i18n';
import { formatKZT } from '../../services/events';

export interface SalesPoint {
  date: string;
  tickets: number;
  revenue_kzt: number;
  cumulative_tickets: number;
}

function formatDay(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' });
}

// daily sales: bar chart with a table toggle
export function SalesChart({ points }: { points: SalesPoint[] }) {
  const [asTable, setAsTable] = useState(false);
  const { t } = useTranslation();

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-500">{t('analytics.chart.empty')}</p>;
  }

  const max = Math.max(...points.map((p) => p.tickets));

  return (
    <div>
      <button onClick={() => setAsTable(!asTable)} className="mb-3 text-xs font-semibold text-blue-600">
        {asTable ? t('analytics.chart.showChart') : t('analytics.chart.showTable')}
      </button>

      {asTable ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th>{t('analytics.chart.day')}</th>
              <th className="text-right">{t('analytics.chart.tickets')}</th>
              <th className="text-right">{t('analytics.chart.total')}</th>
              <th className="text-right">{t('analytics.chart.revenue')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-t">
                <td className="py-1">{formatDay(p.date)}</td>
                <td className="text-right">{p.tickets}</td>
                <td className="text-right">{p.cumulative_tickets}</td>
                <td className="text-right">{formatKZT(p.revenue_kzt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex h-48 items-end gap-1 border-b border-gray-300">
          {points.map((p) => (
            <div key={p.date} className="flex h-full flex-1 flex-col items-center justify-end">
              <span className="mb-1 text-[10px] text-gray-500">{p.tickets}</span>
              <div
                className="w-full max-w-6 rounded-t bg-blue-600"
                style={{ height: `${(p.tickets / max) * 85}%` }}
                title={`${formatDay(p.date)}: ${t('analytics.chart.ticketsCount', { count: p.tickets })}, ${formatKZT(p.revenue_kzt)}`}
              />
            </div>
          ))}
        </div>
      )}

      {!asTable && (
        <div className="mt-1 flex gap-1 text-[10px] text-gray-500">
          {points.map((p, i) => (
            <span key={p.date} className="flex-1 text-center">
              {i % Math.ceil(points.length / 8) === 0 ? formatDay(p.date) : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
