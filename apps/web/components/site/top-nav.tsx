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
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
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
      <svg viewBox="0 0 28 28" className="h-7 w-7" fill="none">
        <circle cx="6" cy="22" r="2.4" fill="hsl(187 100% 50%)" />
        <circle cx="22" cy="6" r="2.4" fill="hsl(43 100% 50%)" />
        <path
          d="M6 22 L22 6"
          stroke="url(#zg)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="zg" x1="6" y1="22" x2="22" y2="6">
            <stop stopColor="hsl(187 100% 50%)" />
            <stop offset="1" stopColor="hsl(43 100% 50%)" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}
