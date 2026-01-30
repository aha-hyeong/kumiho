import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import nameKo from "./locales/ko.json";
import nameEn from "./locales/en.json";

const resources = {
  ko: {
    translation: nameKo,
  },
  en: {
    translation: nameEn,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "ko", // 기본 언어
    debug: import.meta.env.DEV,

    interpolation: {
      escapeValue: false, // React는 기본적으로 XSS를 방지하므로 필요 없음
    },
  });

export default i18n;
