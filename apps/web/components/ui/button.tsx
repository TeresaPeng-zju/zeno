import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const variants = {
  primary:
    "bg-primary text-primary-foreground shadow-[0_2px_10px_hsl(183_86%_52%/0.35),0_1px_2px_hsl(183_86%_52%/0.2)] hover:brightness-110 hover:shadow-[0_4px_20px_hsl(183_86%_52%/0.45),0_1px_3px_hsl(183_86%_52%/0.25)] active:translate-y-px active:shadow-[0_1px_6px_hsl(183_86%_52%/0.3)]",
  solid:
    "bg-foreground text-background shadow-[0_2px_8px_hsl(0_0%_100%/0.1),0_1px_2px_hsl(0_0%_0%/0.2)] hover:opacity-90 hover:shadow-[0_4px_14px_hsl(0_0%_100%/0.15),0_1px_3px_hsl(0_0%_0%/0.25)] active:translate-y-px active:shadow-[0_1px_4px_hsl(0_0%_100%/0.08)]",
  outline:
    "border border-border bg-surface/60 text-foreground shadow-[0_1px_3px_hsl(0_0%_0%/0.2),inset_0_1px_0_hsl(0_0%_100%/0.04)] hover:border-primary/60 hover:bg-surface hover:shadow-[0_2px_8px_hsl(183_86%_52%/0.12),inset_0_1px_0_hsl(0_0%_100%/0.06)] active:translate-y-px",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-accent/60",
} as const;

const sizes = {
  default: "h-10 px-5 py-2",
  lg: "h-12 px-7 text-[15px]",
  sm: "h-9 px-3",
} as const;

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
