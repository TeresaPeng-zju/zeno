"use client";

import { motion } from "framer-motion";

interface RoleJourneyProps {
  current: string;
  target: string;
  /** 0-1 readiness, controls how far the cyan fill travels toward the goal. */
  progress?: number;
}

export function RoleJourney({ current, target, progress = 0.5 }: RoleJourneyProps) {
  const pct = Math.max(0.06, Math.min(0.94, progress));
  return (
    <div className="hairline rounded-2xl bg-card/60 px-6 py-5 backdrop-blur-md sm:px-8 sm:py-6">
      <div className="flex items-center gap-4 sm:gap-6">
        <div className="shrink-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Current Role
          </p>
          <p className="mt-1 text-base font-semibold text-foreground sm:text-lg">{current}</p>
        </div>

        <div className="relative mx-2 flex-1">
          {/* base track */}
          <div className="h-px w-full bg-border" />
          {/* progress fill */}
          <motion.div
            className="absolute left-0 top-0 h-px bg-gradient-to-r from-cyan to-gold"
            initial={{ width: 0 }}
            animate={{ width: `${pct * 100}%` }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
          {/* origin dot */}
          <span className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-cyan shadow-[0_0_12px_hsl(187_100%_50%/0.7)]" />
          {/* traveling marker */}
          <motion.span
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-foreground"
            initial={{ left: 0 }}
            animate={{ left: `${pct * 100}%` }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
          {/* target star */}
          <span className="absolute -right-1 top-1/2 -translate-y-1/2 text-gold">
            <StarIcon />
          </span>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Target Role
          </p>
          <p className="mt-1 text-base font-semibold text-gold sm:text-lg">{target}</p>
        </div>
      </div>
    </div>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="drop-shadow-[0_0_8px_hsl(43_100%_50%/0.7)]">
      <path d="M8 0l1.9 4.6L15 5.2l-3.8 3.3L12.4 14 8 11.3 3.6 14l1.2-5.5L1 5.2l5.1-.6L8 0z" />
    </svg>
  );
}
