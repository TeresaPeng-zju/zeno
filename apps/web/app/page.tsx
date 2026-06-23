"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { InteractiveAurora } from "@/components/interactive-aurora";
import { Starfield } from "@/components/starfield";
import { api, type PathRole } from "@/lib/api";

/* ---------- star particles ----------------------------------------------- */

const C = "hsl(183 86% 52%)";
const G = "hsl(43 100% 50%)";
const M = "hsl(335 100% 65%)";
const W = "hsl(210 25% 80%)";

// size tiers: 1-2 = distant dust (round), 3-5 = near stars (4-pointed), 7-10 = bright stars (4-pointed + strong glow)
// "round" flag: tiny stars stay as circles for realism
const STARS = [
  // — bright anchor stars (few, large, prominent) —
  { x: "50%", y: "25%", size: 10, color: C, glow: 14, anim: "float-2", dur: "7s",  delay: "0s" },
  { x: "70%", y: "11%", size: 8,  color: C, glow: 12, anim: "float-2", dur: "7s",  delay: "0.2s" },
  { x: "5%",  y: "30%", size: 8,  color: C, glow: 12, anim: "float-2", dur: "8s",  delay: "1s" },
  { x: "86%", y: "68%", size: 7,  color: M, glow: 10, anim: "float-1", dur: "8s",  delay: "0.8s" },
  // — medium stars (4-pointed, varied) —
  { x: "3%",  y: "5%",  size: 5, color: C, glow: 8, anim: "float-1", dur: "8s",  delay: "0s" },
  { x: "18%", y: "6%",  size: 5, color: G, glow: 8, anim: "float-1", dur: "12s", delay: "1s" },
  { x: "40%", y: "12%", size: 5, color: C, glow: 7, anim: "float-2", dur: "8s",  delay: "1.5s" },
  { x: "60%", y: "36%", size: 5, color: M, glow: 8, anim: "float-1", dur: "12s", delay: "1.4s" },
  { x: "13%", y: "75%", size: 5, color: C, glow: 7, anim: "float-2", dur: "8s",  delay: "1.9s" },
  { x: "75%", y: "38%", size: 4, color: G, glow: 7, anim: "float-1", dur: "8s",  delay: "2.6s" },
  { x: "44%", y: "40%", size: 4, color: C, glow: 6, anim: "float-1", dur: "8s",  delay: "0.7s" },
  { x: "30%", y: "80%", size: 4, color: C, glow: 6, anim: "float-2", dur: "9s",  delay: "0.6s" },
  { x: "91%", y: "33%", size: 4, color: C, glow: 6, anim: "float-1", dur: "10s", delay: "1.6s" },
  // — small stars (4-pointed, subtle) —
  { x: "25%", y: "18%", size: 3, color: C, glow: 4, anim: "float-2", dur: "9s",  delay: "2s" },
  { x: "55%", y: "16%", size: 3, color: W, glow: 4, anim: "float-2", dur: "9s",  delay: "0.8s" },
  { x: "85%", y: "15%", size: 3, color: W, glow: 4, anim: "float-2", dur: "9s",  delay: "2.2s" },
  { x: "20%", y: "35%", size: 3, color: W, glow: 4, anim: "float-2", dur: "10s", delay: "0.4s" },
  { x: "54%", y: "70%", size: 3, color: C, glow: 4, anim: "float-1", dur: "10s", delay: "2.7s" },
  { x: "70%", y: "66%", size: 3, color: C, glow: 4, anim: "float-1", dur: "9s",  delay: "1.7s" },
  // — distant dust (round, tiny — background depth) —
  { x: "10%", y: "14%", size: 1.5, color: W, glow: 2, anim: "float-2", dur: "10s", delay: "0.5s", round: true },
  { x: "33%", y: "4%",  size: 1,   color: W, glow: 1, anim: "float-1", dur: "11s", delay: "0.3s", round: true },
  { x: "48%", y: "7%",  size: 1.5, color: W, glow: 2, anim: "float-1", dur: "10s", delay: "2.5s", round: true },
  { x: "63%", y: "3%",  size: 1,   color: W, glow: 1, anim: "float-1", dur: "12s", delay: "3s",   round: true },
  { x: "78%", y: "8%",  size: 1.5, color: W, glow: 2, anim: "float-1", dur: "11s", delay: "1.8s", round: true },
  { x: "93%", y: "6%",  size: 1,   color: W, glow: 1, anim: "float-1", dur: "10s", delay: "0.6s", round: true },
  { x: "12%", y: "42%", size: 1.5, color: W, glow: 2, anim: "float-1", dur: "12s", delay: "2.8s", round: true },
  { x: "28%", y: "48%", size: 1,   color: W, glow: 1, anim: "float-1", dur: "9s",  delay: "1.2s", round: true },
  { x: "36%", y: "32%", size: 1.5, color: W, glow: 2, anim: "float-2", dur: "11s", delay: "3.2s", round: true },
  { x: "52%", y: "50%", size: 1,   color: W, glow: 1, anim: "float-2", dur: "10s", delay: "2s",   round: true },
  { x: "67%", y: "45%", size: 1.5, color: W, glow: 2, anim: "float-2", dur: "9s",  delay: "0.9s", round: true },
  { x: "83%", y: "48%", size: 1,   color: W, glow: 1, anim: "float-2", dur: "11s", delay: "0.1s", round: true },
  { x: "4%",  y: "62%", size: 1.5, color: W, glow: 2, anim: "float-1", dur: "10s", delay: "0.3s", round: true },
  { x: "22%", y: "68%", size: 1,   color: W, glow: 1, anim: "float-1", dur: "12s", delay: "2.4s", round: true },
  { x: "46%", y: "78%", size: 1.5, color: W, glow: 2, anim: "float-2", dur: "8s",  delay: "1.3s", round: true },
  { x: "94%", y: "80%", size: 1,   color: W, glow: 1, anim: "float-2", dur: "10s", delay: "1.1s", round: true },
] as const;

/* ---------- animation variants ------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

/* ---------- component ---------------------------------------------------- */

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // path selector state
  const [currentRoles, setCurrentRoles] = useState<PathRole[]>([]);
  const [targetRoles, setTargetRoles] = useState<PathRole[]>([]);
  const [currentRole, setCurrentRole] = useState("");
  const [targetRole, setTargetRole] = useState("");

  useEffect(() => {
    api.paths().then((data) => {
      setCurrentRoles(data.current_roles);
      setTargetRoles(data.target_roles);
      if (data.current_roles.length > 0) setCurrentRole(data.current_roles[0].id);
      if (data.target_roles.length > 0) setTargetRole(data.target_roles[0].id);
    }).catch(() => {});
  }, []);

  async function startPath() {
    if (!currentRole) return;
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await api.createSession("base", currentRole);
      router.push(`/skills?session=${session_id}&current_role=${currentRole}&target_role=${targetRole}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("backendDown"));
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* ── Aurora + Starfield ──────────────────────────────────────── */}
      <InteractiveAurora />
      <Starfield stars={STARS} />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="container relative z-10 flex flex-col items-center pt-28 text-center sm:pt-36 before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:rounded-full before:bg-[radial-gradient(ellipse_at_center,rgba(10,15,30,0.4)_0%,transparent_70%)]">
        {/* title */}
        <motion.h1
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 max-w-5xl cursor-default pb-3 text-5xl font-extrabold leading-[1.08] tracking-tight text-gradient sm:text-7xl"
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
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-2xl cursor-default text-lg leading-relaxed text-muted-foreground"
        >
          {t("subtitle")}
        </motion.p>

        {/* ── Path Selector Card ────────────────────────────────────── */}
        <motion.div
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-14 w-full max-w-xl"
        >
          <div className="border-beam relative rounded-2xl bg-card/40 p-6 backdrop-blur-xl sm:p-8">

            <div className="space-y-6">
              {/* Current Role */}
              <div>
                <label className="mb-2.5 block text-base font-semibold text-foreground">
                  {t("iAmA")}
                </label>
                <Select
                  value={currentRole}
                  options={currentRoles.map((r) => ({ value: r.id, label: r.label }))}
                  onChange={setCurrentRole}
                  placeholder="Select your current role…"
                />
              </div>

              {/* Target Role */}
              <div>
                <label className="mb-2.5 block text-base font-semibold text-foreground">
                  {t("iWantTo")}
                </label>
                <Select
                  value={targetRole}
                  options={targetRoles.map((r) => ({ value: r.id, label: r.label }))}
                  onChange={setTargetRole}
                  placeholder="Select your target role…"
                />
              </div>

              {/* CTA */}
              {error && <p className="text-sm text-magenta">{error}</p>}
              <Button
                size="lg"
                variant="primary"
                onClick={startPath}
                disabled={loading || !currentRole}
                className="w-full text-base"
              >
                {loading ? t("mapping") : t("showMyPath")}
              </Button>
            </div>
          </div>
        </motion.div>

        <div className="pb-20" />
      </section>
    </main>
  );
}

