"use client";

import Link from "next/link";

const NAV_LINKS = [
  { label: "Career Graph", href: "/#graph" },
  { label: "Skills", href: "/skills" },
  { label: "Gap Analysis", href: "/#gap" },
  { label: "Roadmap", href: "/#roadmap" },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <ZenoMark />
          <span className="text-[17px] font-semibold tracking-tight">Zeno</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <Link
            href="/skills"
            className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/skills"
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-cyan/90"
          >
            Get started
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
