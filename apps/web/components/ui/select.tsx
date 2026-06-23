"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({ value, options, onChange, placeholder, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-base font-medium transition-all",
          "border-border/60 bg-surface/60 text-foreground backdrop-blur-sm",
          "shadow-[0_1px_3px_hsl(0_0%_0%/0.25),inset_0_1px_0_hsl(0_0%_100%/0.03)]",
          "hover:border-cyan/40 hover:shadow-[0_2px_8px_hsl(183_86%_52%/0.1)]",
          open && "border-cyan/50 shadow-[0_0_0_2px_hsl(183_86%_52%/0.15)]",
        )}
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <ChevronIcon open={open} />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-xl border border-border/60 bg-card/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-lg px-3.5 py-2.5 text-left text-base font-medium transition-colors",
                  option.value === value
                    ? "bg-cyan/10 text-cyan"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                {option.value === value && (
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-cyan" />
                )}
                {option.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={cn(
        "text-muted-foreground transition-transform duration-200",
        open && "rotate-180",
      )}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
