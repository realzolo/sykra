export const locales = ['en', 'zh', 'ja', 'es', 'zh-TW'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '简体中文',
  ja: '日本語',
  es: 'Español',
  'zh-TW': '繁體中文',
};
