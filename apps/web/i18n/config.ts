export const locales = ["en", "zh", "zh-TW"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// Labels shown in the language dropdown.
export const localeNames: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  "zh-TW": "繁體中文",
};

// Cookie that persists the user's chosen locale (no i18n routing — we keep
// clean URLs and read/write the locale from this cookie instead).
export const LOCALE_COOKIE = "ZENO_LOCALE";

// Cookie for inferred market region (used for JD evidence weighting).
// Values: "cn" (domestic) | "intl" (international) | not set.
// Priority: user explicit choice > browser language inference.
export const REGION_COOKIE = "ZENO_REGION";

export type Region = "cn" | "intl";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Infer a market region from the browser locale. This is a soft default —
 * the user can always override it. zh / zh-CN / zh-TW → cn; everything else → intl.
 * The result is used to weight JD evidence sources (domestic vs Field Guide).
 */
export function inferRegionFromLocale(locale: Locale | string): Region {
  const lower = (locale || "").toLowerCase();
  if (lower.startsWith("zh")) return "cn";
  return "intl";
}
