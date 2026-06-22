"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

/* star particles — static positions (% based), different sizes/colors/speeds */
const C = "hsl(183 86% 52%)";
const G = "hsl(43 100% 50%)";
const M = "hsl(335 100% 65%)";
const W = "hsl(220 30% 85%)";

const STARS = [
  { x: "8%",  y: "12%", size: 2.5, color: C, glow: 8,  anim: "float-1", dur: "7s",  delay: "0s" },
  { x: "15%", y: "35%", size: 2,   color: W, glow: 5,  anim: "float-2", dur: "9s",  delay: "1s" },
  { x: "22%", y: "8%",  size: 1.5, color: G, glow: 6,  anim: "float-1", dur: "11s", delay: "2s" },
  { x: "30%", y: "55%", size: 2,   color: C, glow: 7,  anim: "float-2", dur: "8s",  delay: "0.5s" },
  { x: "38%", y: "22%", size: 1.5, color: W, glow: 4,  anim: "float-1", dur: "10s", delay: "3s" },
  { x: "45%", y: "75%", size: 2.5, color: M, glow: 8,  anim: "float-2", dur: "12s", delay: "1.5s" },
  { x: "52%", y: "15%", size: 2,   color: C, glow: 6,  anim: "float-1", dur: "9s",  delay: "0.8s" },
  { x: "60%", y: "45%", size: 1.5, color: G, glow: 5,  anim: "float-2", dur: "7.5s",delay: "2.5s" },
  { x: "68%", y: "10%", size: 2,   color: W, glow: 5,  anim: "float-1", dur: "11s", delay: "1.2s" },
  { x: "75%", y: "60%", size: 2.5, color: C, glow: 9,  anim: "float-2", dur: "8.5s",delay: "0.3s" },
  { x: "82%", y: "30%", size: 1.5, color: G, glow: 6,  anim: "float-1", dur: "10s", delay: "3.5s" },
  { x: "88%", y: "18%", size: 2,   color: C, glow: 7,  anim: "float-2", dur: "9s",  delay: "0.7s" },
  { x: "92%", y: "50%", size: 2,   color: M, glow: 7,  anim: "float-1", dur: "12s", delay: "2s" },
  { x: "5%",  y: "70%", size: 1.5, color: W, glow: 4,  anim: "float-2", dur: "8s",  delay: "1.8s" },
  { x: "35%", y: "85%", size: 2,   color: C, glow: 6,  anim: "float-1", dur: "10s", delay: "0.4s" },
  { x: "55%", y: "88%", size: 1.5, color: G, glow: 5,  anim: "float-2", dur: "11s", delay: "3s" },
  { x: "78%", y: "80%", size: 2,   color: C, glow: 7,  anim: "float-1", dur: "9s",  delay: "1.6s" },
  { x: "95%", y: "75%", size: 1.5, color: W, glow: 4,  anim: "float-2", dur: "7s",  delay: "2.8s" },
];

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/* ---------- animation variants ------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

const popIn = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

/* ---------- mini-diagnosis demo skills ----------------------------------- */

const DEMO_SKILLS = [
  { id: "ts", label: "TypeScript", category: "foundation" },
  { id: "react", label: "React", category: "foundation" },
  { id: "api", label: "API Design", category: "foundation" },
  { id: "prompt", label: "Prompt Engineering", category: "llm" },
  { id: "rag", label: "RAG / Vector Search", category: "data" },
  { id: "agent", label: "Agent / Tool Use", category: "llm" },
  { id: "eval", label: "Offline Eval", category: "eval" },
  { id: "stream", label: "Streaming", category: "foundation" },
] as const;

type SkillId = (typeof DEMO_SKILLS)[number]["id"];

/* ---------- component ---------------------------------------------------- */

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // mini diagnosis state
  const [picked, setPicked] = useState<Set<SkillId>>(new Set());
  const [showResult, setShowResult] = useState(false);

  const toggle = useCallback((id: SkillId) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShowResult(false);
  }, []);

  const diagnose = useCallback(() => {
    if (picked.size === 0) return;
    setShowResult(true);
  }, [picked]);

  const gaps = DEMO_SKILLS.filter((s) => !picked.has(s.id));
  const gapCount = gaps.length;

  async function mapCareer() {
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await api.createSession("base");
      router.push(`/skills?session=${session_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("backendDown"));
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* ── Starfield background ─────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 bg-starfield" />
      <div className="stars-layer">
        {STARS.map((s, i) => (
          <span
            key={i}
            className="star-dot"
            style={{
              left: s.x,
              top: s.y,
              width: s.size,
              height: s.size,
              background: s.color,
              boxShadow: `0 0 ${s.glow}px ${s.color}`,
              animationName: s.anim,
              animationDuration: s.dur,
              animationDelay: s.delay,
            }}
          />
        ))}
      </div>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="container relative flex flex-col items-center pt-28 text-center sm:pt-36">
        {/* badge */}
        <motion.span
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="hairline inline-flex items-center gap-2 rounded-full bg-card/50 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-md"
        >
          <SparkIcon /> {t("badge")}
        </motion.span>

        {/* title */}
        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 max-w-5xl pb-3 text-5xl font-extrabold leading-[1.08] tracking-tight text-gradient sm:text-7xl"
        >
          {t("titleLine1")}
          <br />
          <span className="whitespace-nowrap">
            <span className="text-cyan [-webkit-text-fill-color:hsl(183_86%_52%)]">
              {t("titleNavigate")}
            </span>
            {t("titleLine2")}
          </span>
        </motion.h1>

        {/* subtitle */}
        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground"
        >
          {t("subtitle")}
        </motion.p>

        {/* ── Mini Diagnosis Card ─────────────────────────────────── */}
        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-14 w-full max-w-2xl"
        >
          <div className="hairline relative overflow-hidden rounded-2xl bg-card/40 p-6 backdrop-blur-xl sm:p-8">
            {/* subtle top-edge glow line */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan/40 to-transparent" />

            <p className="text-left text-sm font-medium text-muted-foreground">
              {t("miniTitle")}
            </p>

            {/* skill capsules */}
            <div className="mt-4 flex flex-wrap gap-2">
              {DEMO_SKILLS.map((s) => {
                const active = picked.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    className={
                      "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200 " +
                      (active
                        ? "border-cyan/60 bg-cyan/10 text-cyan shadow-[0_0_16px_hsl(183_86%_52%/0.15)]"
                        : "border-border/60 bg-surface/40 text-muted-foreground hover:border-cyan/30 hover:text-foreground")
                    }
                  >
                    {active && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan" />}
                    {s.label}
                  </button>
                );
              })}
            </div>

            {/* diagnose button */}
            <div className="mt-5 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={diagnose}
                disabled={picked.size === 0}
                className="border-cyan/30 text-cyan hover:bg-cyan/10"
              >
                {t("miniAnalyze")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {picked.size > 0 ? `${picked.size} selected` : t("miniHint")}
              </span>
            </div>

            {/* result reveal */}
            <AnimatePresence>
              {showResult && (
                <motion.div
                  variants={popIn}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="mt-5 rounded-xl border border-cyan/20 bg-background/60 px-5 py-4 backdrop-blur"
                >
                  {/* scan line */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden rounded-xl">
                    <div
                      className="absolute top-0 h-full w-[30%] bg-gradient-to-r from-transparent via-cyan/5 to-transparent"
                      style={{ animation: "scan-reveal 2.5s ease-out forwards" }}
                    />
                  </div>

                  <div className="relative space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      <span className="text-cyan">{picked.size}</span> strengths detected ·{" "}
                      <span className="text-magenta">{gapCount}</span> gaps to AI Engineer
                    </p>

                    {gapCount > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {gaps.slice(0, 4).map((g) => (
                          <span
                            key={g.id}
                            className="rounded-full border border-magenta/30 bg-magenta/5 px-2.5 py-0.5 text-xs text-magenta"
                          >
                            △ {g.label}
                          </span>
                        ))}
                        {gapCount > 4 && (
                          <span className="px-1 text-xs text-muted-foreground">
                            +{gapCount - 4} more
                          </span>
                        )}
                      </div>
                    )}

                    <button
                      onClick={mapCareer}
                      disabled={loading}
                      className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-cyan transition-colors hover:text-cyan/80"
                    >
                      {loading ? t("mapping") : t("miniCTA")}
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="translate-y-px">
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* fallback CTA for users who skip the mini-demo */}
        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 pb-20"
        >
          {error && <p className="mb-3 text-sm text-magenta">{error}</p>}
          <Button size="lg" variant="solid" onClick={mapCareer} disabled={loading}>
            {loading ? t("mapping") : t("mapMyCareer")}
          </Button>
        </motion.div>
      </section>
    </main>
  );
}

/* ---------- icons -------------------------------------------------------- */

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 0l1.3 4.7L13 6 8.3 7.3 7 12 5.7 7.3 1 6l4.7-1.3L7 0z"
        fill="hsl(183 86% 52%)"
      />
    </svg>
  );
}
