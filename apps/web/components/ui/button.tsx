import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const variants = {
  primary:
    "bg-primary text-primary-foreground hover:brightness-110 shadow-[0_0_24px_hsl(187_100%_50%/0.25)]",
  solid: "bg-foreground text-background hover:opacity-90",
  outline:
    "border border-border bg-surface/60 text-foreground hover:border-primary/60 hover:bg-surface",
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
