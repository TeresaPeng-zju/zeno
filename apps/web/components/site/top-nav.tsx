"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/site/language-switcher";

export function TopNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  // The flow sections (skills / gap analysis / roadmap) are *parts of the
  // result report* — their anchors (#gap / #roadmap) live on /result, and
  // skill selection is a step inside the flow. So we surface them contextually
  // instead of as global links pointing at non-existent homepage anchors:
  //   - result (/result) → in-page anchors to gap analysis & roadmap (a real
  //     pair of links that reads as a menu)
  //   - everywhere else (home / mid-flow) → none. On the homepage a lone
  //     "Career Graph" link sat awkwardly centered, looking neither like a menu
  //     nor a CTA; the hero's "Explore the graph" button already scrolls there,
  //     so we keep the bar clean (logo ↔ language/sign-in/CTA).
  const onResult = pathname?.startsWith("/result");
  const navLinks = onResult
    ? [
        { label: t("gapAnalysis"), href: "#gap" },
        { label: t("roadmap"), href: "#roadmap" },
      ]
    : [];

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <ZenoMark />
          <span className="text-[17px] font-semibold tracking-tight">Zeno</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <Link
            href="/skills"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            {t("signIn")}
          </Link>
          <Link
            href="/skills"
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-background shadow-[0_2px_8px_hsl(183_86%_52%/0.35),0_1px_2px_hsl(183_86%_52%/0.2)] transition-all hover:bg-cyan/90 hover:shadow-[0_4px_16px_hsl(183_86%_52%/0.4),0_1px_3px_hsl(183_86%_52%/0.25)] active:translate-y-px active:shadow-[0_1px_4px_hsl(183_86%_52%/0.3)]"
          >
            {t("getStarted")}
          </Link>
        </div>
      </div>
    </header>
  );
}

function ZenoMark() {
  return (
    <span className="relative flex h-7 w-7 items-center justify-center">
      <span className="absolute inset-0 rounded-md bg-cyan/15" />
      <svg viewBox="0 0 24 24" className="relative h-5 w-5 text-cyan" fill="none" aria-hidden="true">
        <circle cx="5" cy="6" r="2" fill="currentColor" />
        <circle cx="19" cy="18" r="2.4" className="fill-gold" />
        <circle cx="13" cy="8" r="1.4" fill="currentColor" opacity="0.7" />
        <path d="M5 6 L13 8 L19 18" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    </span>
  );
}
