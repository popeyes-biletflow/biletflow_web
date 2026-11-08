import { useTranslation } from 'react-i18next';
import { currentLang } from '../i18n';

interface Props { venueName: string; venueAddress: string }

// Keyless Google Maps embed + deep links to Google / Yandex Maps.
export function VenueMap({ venueName, venueAddress }: Props) {
  const { t } = useTranslation();
  const query = [venueName, venueAddress].filter(Boolean).join(', ');
  if (!query) return null;
  const q = encodeURIComponent(query);
  const hl = currentLang() === 'en' ? 'en' : 'ru'; // Google Maps has no Kazakh UI; Russian is the closest.

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <h3 className="px-5 pt-5 font-semibold">{t('map.title')}</h3>
      <p className="px-5 text-sm text-gray-600">{query}</p>
      <iframe
        title={t('map.iframeTitle', { venue: venueName || venueAddress })}
        src={`https://maps.google.com/maps?q=${q}&hl=${hl}&z=15&output=embed`}
        className="mt-3 h-72 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <div className="flex flex-wrap gap-4 px-5 py-3 text-sm">
        <a className="font-medium text-blue-600 hover:underline" target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${q}`}>{t('map.openGoogle')}</a>
        <a className="font-medium text-blue-600 hover:underline" target="_blank" rel="noreferrer"
          href={`https://yandex.kz/maps/?text=${q}`}>{t('map.openYandex')}</a>
      </div>
    </section>
  );
}
