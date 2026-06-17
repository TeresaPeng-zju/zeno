"use client";

import { motion } from "framer-motion";

interface CircularProgressProps {
  /** 0-100 */
  value: number;
  size?: number;
  label?: string;
  caption?: string;
}

export function CircularProgress({
  value,
  size = 180,
  label = "Career Readiness",
  caption,
}: CircularProgressProps) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = c * (1 - clamped / 100);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#readiness)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
        <defs>
          <linearGradient id="readiness" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="hsl(187 100% 50%)" />
            <stop offset="1" stopColor="hsl(165 100% 39%)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-4xl font-bold tracking-tight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {Math.round(clamped)}%
        </motion.span>
        <span className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {caption && <span className="mt-1 text-xs text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}
