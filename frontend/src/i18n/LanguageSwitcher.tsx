import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './index';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  return (
    <div role="group" aria-label="Language" className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-semibold">
      {LANGUAGES.map((l) => {
        const active = i18n.resolvedLanguage === l;
        return (
          <button key={l} onClick={() => i18n.changeLanguage(l)} aria-pressed={active}
            className={`px-2 py-1 ${active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
            {l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
