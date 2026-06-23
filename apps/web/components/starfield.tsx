"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: string;
  y: string;
  size: number;
  color: string;
  glow: number;
  anim: string;
  dur: string;
  delay: string;
  readonly round?: boolean;
}

interface Props {
  stars: readonly Star[];
}

const GLOW_RADIUS = 140; // px

/**
 * Starfield with mouse-proximity glow.
 * Large stars are 4-pointed (CSS clip-path), tiny dust stays round.
 */
export function Starfield({ stars }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    function onMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    }
    function onLeave() {
      mouseRef.current = { x: -9999, y: -9999 };
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const { x: mx, y: my } = mouseRef.current;
      const dots = layer!.querySelectorAll<HTMLSpanElement>(".star-dot");

      dots.forEach((dot) => {
        const rect = dot.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const color = dot.dataset.color || "white";
        const baseGlow = parseFloat(dot.dataset.baseGlow || "6");

        if (dist < GLOW_RADIUS) {
          const intensity = (1 - dist / GLOW_RADIUS) ** 1.5;
          const pulse = Math.sin(performance.now() * 0.004) * 0.15 + 0.85;
          const glow = intensity * pulse;
          const extraGlow = glow * 80;
          const scale = 1 + glow * 0.8;
          dot.style.boxShadow = `0 0 ${baseGlow + extraGlow}px ${color}, 0 0 ${baseGlow + extraGlow * 1.8}px ${color}`;
          dot.style.transform = `scale(${scale})`;
        } else {
          dot.style.boxShadow = `0 0 ${baseGlow}px ${color}`;
          dot.style.transform = "scale(1)";
        }
      });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div ref={layerRef} className="stars-layer">
      {stars.map((s, i) => (
        <span
          key={i}
          className={`star-dot${s.round ? " star-round" : ""}`}
          data-base-glow={s.glow}
          data-color={s.color}
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            background: s.color,
            boxShadow: `0 0 ${s.glow}px ${s.color}`,
            transition: "box-shadow 0.08s linear, transform 0.08s linear",
            animationName: s.anim,
            animationDuration: s.dur,
            animationDelay: s.delay,
          }}
        />
      ))}
    </div>
  );
}
