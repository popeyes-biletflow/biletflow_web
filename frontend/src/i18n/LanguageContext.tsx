import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'kk' | 'ru' | 'en';

const dict = {
  en: { discover: 'Discover events', search: 'Search by name, venue or address…', all: 'All', details: 'Details', back: '← Back to events', when: 'Date & time', venue: 'Venue', tickets: 'Ticket tiers', addCal: 'Add to calendar (.ics)', loading: 'Loading…', none: 'No events match your filters.', loadError: 'Could not load events. Is the backend running?', notFound: 'Event not found', from: 'from', soldOut: 'Sold out', left: 'left' },
  ru: { discover: 'Афиша событий', search: 'Поиск по названию, площадке или адресу…', all: 'Все', details: 'Подробнее', back: '← К событиям', when: 'Дата и время', venue: 'Площадка', tickets: 'Категории билетов', addCal: 'Добавить в календарь (.ics)', loading: 'Загрузка…', none: 'Нет событий по выбранным фильтрам.', loadError: 'Не удалось загрузить события. Бэкенд запущен?', notFound: 'Событие не найдено', from: 'от', soldOut: 'Распродано', left: 'осталось' },
  kk: { discover: 'Іс-шаралар афишасы', search: 'Атауы, алаңы немесе мекенжайы бойынша іздеу…', all: 'Барлығы', details: 'Толығырақ', back: '← Іс-шараларға', when: 'Күні мен уақыты', venue: 'Өтетін орны', tickets: 'Билет санаттары', addCal: 'Күнтізбеге қосу (.ics)', loading: 'Жүктелуде…', none: 'Сүзгілерге сай іс-шара жоқ.', loadError: 'Іс-шаралар жүктелмеді. Бэкенд іске қосылған ба?', notFound: 'Іс-шара табылмады', from: 'бастап', soldOut: 'Сатылып кетті', left: 'қалды' },
} as const;

export type TKey = keyof typeof dict.en;
const locales: Record<Lang, string> = { kk: 'kk-KZ', ru: 'ru-RU', en: 'en-GB' };

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string; locale: string }
const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>((localStorage.getItem('lang') as Lang) || 'ru');
  const setLang = (l: Lang) => { setLangState(l); localStorage.setItem('lang', l); document.documentElement.lang = l; };
  return (
    <LanguageContext.Provider value={{ lang, setLang, t: (k) => dict[lang][k], locale: locales[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const c = useContext(LanguageContext);
  if (!c) throw new Error('useLanguage must be used inside LanguageProvider');
  return c;
}

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-semibold">
      {(['kk', 'ru', 'en'] as Lang[]).map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`px-2 py-1 ${lang === l ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
