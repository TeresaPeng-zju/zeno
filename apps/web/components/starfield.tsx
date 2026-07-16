const COLORS = [
  "hsl(183 86% 52%)",   // cyan
  "hsl(183 86% 52%)",   // cyan (weighted)
  "hsl(210 25% 80%)",   // white-blue
  "hsl(210 25% 80%)",   // white-blue (weighted)
  "hsl(43 100% 50%)",   // gold
  "hsl(335 100% 65%)",  // magenta
];

const STAR_COUNT = 32;

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
  // Seeded generator keeps server and client markup identical.
  let seed = 0x5a454e4f;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars: GeneratedStar[] = [];
  for (let i = 0; i < count; i++) {
    const x = random() * 100;
    const y = random() * 100;
    const tier = random();
    let size: number, glow: number, round: boolean;

    if (tier < 0.08) {
      // Bright anchor stars (few, large)
      size = 7 + random() * 4;
      glow = 10 + random() * 5;
      round = false;
    } else if (tier < 0.3) {
      // Medium stars (4-pointed)
      size = 3.5 + random() * 2.5;
      glow = 5 + random() * 4;
      round = false;
    } else {
      // Distant dust (round, tiny)
      size = 1 + random() * 1.5;
      glow = 1 + random() * 2;
      round = true;
    }

    const color = COLORS[Math.floor(random() * COLORS.length)];
    const delay = random() * 4;
    const duration = 2 + random() * 3;

    stars.push({ x, y, size, color, glow, round, delay, duration });
  }
  return stars;
}

const STARS = generateStars(STAR_COUNT);

/**
 * Deterministic CSS-only starfield. It intentionally has no mouse listener or
 * requestAnimationFrame loop, so it stays compositor-friendly while idle.
 */
export function Starfield() {
  return (
    <div className="stars-layer">
      {STARS.map((s, i) => (
        <span
          key={i}
          className={`star-dot${s.round ? " star-round" : ""}`}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: s.color,
            boxShadow: `0 0 ${s.glow}px ${s.color}`,
            animationName: "twinkle",
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
