export const locales = ["en", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// Short label shown in the language switcher.
export const localeNames: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
};

// Cookie that persists the user's chosen locale (no i18n routing — we keep
// clean URLs and read/write the locale from this cookie instead).
export const LOCALE_COOKIE = "ZENO_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
