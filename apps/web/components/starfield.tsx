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

const STAR_COUNT = 32;
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
    if (!layer || stars.length === 0) return;

    // 缓存每颗星的视口中心，避免在 rAF 循环里每帧 getBoundingClientRect（强制 reflow）
    const dots = Array.from(layer.querySelectorAll<HTMLSpanElement>(".star-dot"));
    const meta = dots.map((d) => ({
      color: d.dataset.color || "white",
      baseGlow: parseFloat(d.dataset.baseGlow || "4"),
    }));
    let centers = dots.map((d) => {
      const r = d.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    const recompute = () => {
      centers = dots.map((d) => {
        const r = d.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
    };

    function onMove(e: MouseEvent) { mouseRef.current = { x: e.clientX, y: e.clientY }; }
    function onLeave() { mouseRef.current = { x: -9999, y: -9999 }; }

    let dirty = false; // 鼠标曾靠近、需要复位一次
    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const { x: mx, y: my } = mouseRef.current;
      if (mx < 0) {
        // 鼠标不在窗口内：复位一次后停止逐帧计算
        if (dirty) {
          for (let i = 0; i < dots.length; i++) {
            dots[i].style.boxShadow = `0 0 ${meta[i].baseGlow}px ${meta[i].color}`;
            dots[i].style.transform = "scale(1)";
          }
          dirty = false;
        }
        return;
      }
      dirty = true;
      const pulse = Math.sin(performance.now() * 0.004) * 0.15 + 0.85;
      for (let i = 0; i < dots.length; i++) {
        const { cx, cy } = centers[i];
        const dx = mx - cx, dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const { color, baseGlow } = meta[i];
        if (dist < GLOW_RADIUS) {
          const intensity = (1 - dist / GLOW_RADIUS) ** 1.5;
          const glow = intensity * pulse;
          const extraGlow = glow * 80;
          dots[i].style.boxShadow = `0 0 ${baseGlow + extraGlow}px ${color}, 0 0 ${baseGlow + extraGlow * 1.8}px ${color}`;
          dots[i].style.transform = `scale(${1 + glow * 0.8})`;
        } else {
          dots[i].style.boxShadow = `0 0 ${baseGlow}px ${color}`;
          dots[i].style.transform = "scale(1)";
        }
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { passive: true });
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute);
    };
  }, [stars]);

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
