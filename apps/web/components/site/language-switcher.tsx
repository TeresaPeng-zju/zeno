"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";

import { locales, localeNames, type Locale } from "@/i18n/config";
import { setUserLocale } from "@/i18n/locale";

export function LanguageSwitcher() {
  const active = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    if (locale === active) return;
    startTransition(async () => {
      await setUserLocale(locale);
    });
  }

  return (
    <div
      className="hairline inline-flex items-center gap-0.5 rounded-full bg-card/60 p-0.5 text-xs backdrop-blur"
      role="group"
      aria-label="Language"
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          disabled={pending}
          aria-pressed={l === active}
          className={
            "rounded-full px-2.5 py-1 font-medium transition-colors disabled:opacity-60 " +
            (l === active
              ? "bg-cyan/15 text-cyan"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {localeNames[l]}
        </button>
      ))}
    </div>
  );
}
