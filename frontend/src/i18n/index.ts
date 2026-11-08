import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ru from './locales/ru.json';
import kk from './locales/kk.json';

export const LANGUAGES = ['kk', 'ru', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];

// BCP-47 locales used for Intl date / number formatting.
export const LOCALES: Record<Lang, string> = { kk: 'kk-KZ', ru: 'ru-RU', en: 'en-GB' };

// Date formats live in the locale dictionaries (dates.months / dates.card / dates.full),
// so Kazakh renders correctly even in browsers without Kazakh Intl data.
export type DateStyle = 'card' | 'full';

function partsInZone(iso: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { year: parts.year, month: Number(parts.month) - 1, day: parts.day, weekday: wd, time: `${parts.hour}:${parts.minute}` };
}

export function formatEventDate(iso: string, timeZone: string, style: DateStyle = 'card'): string {
  const p = partsInZone(iso, timeZone);
  const months = i18n.t('dates.months', { returnObjects: true }) as string[];
  const monthsShort = i18n.t('dates.monthsShort', { returnObjects: true }) as string[];
  const weekdays = i18n.t('dates.weekdays', { returnObjects: true }) as string[];
  return i18n.t(`dates.${style}`, {
    year: p.year, day: p.day, time: p.time,
    month: months[p.month], monthShort: monthsShort[p.month], weekday: weekdays[p.weekday],
  });
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru }, kk: { translation: kk } },
    supportedLngs: LANGUAGES,
    fallbackLng: 'ru',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'lang', caches: ['localStorage'] },
  });

i18n.on('languageChanged', (lng) => { document.documentElement.lang = lng; });

export const currentLang = (): Lang => (LANGUAGES.find((l) => i18n.resolvedLanguage === l) ?? 'ru');
export const currentLocale = () => LOCALES[currentLang()];

// "Music" / "music" / "МУЗЫКА"-style raw categories -> translated label, falling back to the raw value.
export const categoryKey = (raw: string) => raw.trim().toLowerCase();

export default i18n;
