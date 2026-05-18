import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import en from './locales/en.json';
import es from './locales/es.json';

const resources = {
  ru: { translation: ru },
  en: { translation: en },
  es: { translation: es }
};

// Безопасное получение сохраненного языка с проверкой наличия window (для SSR/Node окружений)
const getSavedLanguage = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return localStorage.getItem('language') || 'ru';
  }
  return 'ru';
};

const savedLanguage = getSavedLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: 'ru',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
