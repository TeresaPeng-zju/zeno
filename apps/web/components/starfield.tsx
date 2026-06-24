"use client";

import { useEffect, useRef, useState } from "react";

const COLORS = [
  "hsl(183 86% 52%)",   // cyan
  "hsl(183 86% 52%)",   // cyan (weighted)
  "hsl(210 25% 80%)",   // white-blue
  "hsl(210 25% 80%)",   // white-blue (weighted)
  "hsl(43 100% 50%)",   // gold
  "hsl(335 100% 65%)",  // magenta
];

const STAR_COUNT = 50;
const GLOW_RADIUS = 140;

interface GeneratedStar {
  x: number; // percentage
  y: number;
  size: number;
  color: string;
  glow: number;
  round: boolean;
  delay: number; // animation delay in seconds
  duration: number; // twinkle duration
}

function generateStars(count: number): GeneratedStar[] {
  const stars: GeneratedStar[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const tier = Math.random();
    let size: number, glow: number, round: boolean;

    if (tier < 0.08) {
      // Bright anchor stars (few, large)
      size = 7 + Math.random() * 4;
      glow = 10 + Math.random() * 5;
      round = false;
    } else if (tier < 0.3) {
      // Medium stars (4-pointed)
      size = 3.5 + Math.random() * 2.5;
      glow = 5 + Math.random() * 4;
      round = false;
    } else {
      // Distant dust (round, tiny)
      size = 1 + Math.random() * 1.5;
      glow = 1 + Math.random() * 2;
      round = true;
    }

    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const delay = Math.random() * 4;
    const duration = 2 + Math.random() * 3;

    stars.push({ x, y, size, color, glow, round, delay, duration });
  }
  return stars;
}

/**
 * Randomized starfield with twinkle animation + mouse-proximity glow.
 * Large stars: 4-pointed (clip-path). Tiny dust: round.
 */
export function Starfield() {
  const layerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);

  // Generate stars only on client mount to avoid hydration mismatch
  const [stars, setStars] = useState<GeneratedStar[]>([]);
  useEffect(() => {
    setStars(generateStars(STAR_COUNT));
  }, []);

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
        const baseGlow = parseFloat(dot.dataset.baseGlow || "4");

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
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: s.color,
            boxShadow: `0 0 ${s.glow}px ${s.color}`,
            transition: "box-shadow 0.08s linear, transform 0.08s linear",
            animationName: "twinkle",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
