"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { inferRegionFromLocale, REGION_COOKIE } from "@/i18n/config";

/**
 * Silently sets the ZENO_REGION cookie on first visit based on the browser locale.
 * If the user has already set it (explicitly or from a previous visit), we don't
 * overwrite. This is the "auto-guess + allow override" strategy that Perplexity
 * recommended: no popup, no privacy question, just a soft default that persists.
 */
export function RegionInit() {
  const locale = useLocale();

  useEffect(() => {
    // Don't overwrite if already set
    if (document.cookie.includes(REGION_COOKIE)) return;

    const region = inferRegionFromLocale(locale);
    document.cookie = `${REGION_COOKIE}=${region};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  }, [locale]);

  return null;
}
