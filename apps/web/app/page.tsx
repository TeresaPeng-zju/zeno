"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { RoleJourney } from "@/components/zeno/role-journey";
import { CareerGraph } from "@/components/zeno/career-graph";
import { api } from "@/lib/api";

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations("home");
  const tg = useTranslations("graph");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mapCareer() {
    setLoading(true);
    setError(null);
    try {
      // Zeno's direction is the role transition itself (engineer → AI engineer);
      // we no longer ask users to pick an intra-role sub-orientation, so the
      // session always starts from the general ("base") path.
      const { session_id } = await api.createSession("base");
      router.push(`/skills?session=${session_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("backendDown"));
      setLoading(false);
    }
  }

  return (
    <main className="relative overflow-hidden">
      {/* single ambient glow — the only "background movement" allowed */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-aurora" />

      <section className="container relative flex flex-col items-center pt-24 text-center">
        <motion.span
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="hairline inline-flex items-center gap-2 rounded-full bg-card/60 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur"
        >
          <SparkIcon /> {t("badge")}
        </motion.span>

        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-7 max-w-5xl pb-3 text-5xl font-extrabold leading-tight tracking-tight text-gradient sm:text-7xl"
        >
          {t("titleLine1")}
          <br />
          {/* Keep the whole second line together so "go." never wraps off on
              its own; on wide screens it stays a single clean line. */}
          <span className="whitespace-nowrap">
            <span className="text-cyan [-webkit-text-fill-color:hsl(183_86%_52%)]">
              {t("titleNavigate")}
            </span>
            {t("titleLine2")}
          </span>
        </motion.h1>

        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-3xl text-lg leading-relaxed text-muted-foreground"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-9 flex items-center gap-3"
        >
          <Button size="lg" variant="solid" onClick={mapCareer} disabled={loading}>
            {loading ? t("mapping") : t("mapMyCareer")}
          </Button>
          <Link href="/#graph">
            <Button size="lg" variant="outline">
              {t("exploreGraph")}
            </Button>
          </Link>
        </motion.div>
        {error && <p className="mt-3 text-sm text-magenta">{error}</p>}

        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-16 w-full max-w-4xl"
        >
          <RoleJourney current={tr("frontend")} target={tr("aiEngineer")} progress={0.4} />
        </motion.div>
      </section>

      {/* Career graph below the fold */}
      <section id="graph" className="container relative mt-20 pb-28">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t("constellationTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Legend dot="bg-cyan" label={tg("legendHave")} /> ·{" "}
              <Legend dot="bg-gold" label={tg("legendInProgress")} /> ·{" "}
              <Legend dot="bg-magenta" label={tg("legendGap")} /> — {tg("legendHint")}
            </p>
          </div>
          <Link href="/skills" className="hidden text-sm text-cyan hover:underline sm:block">
            {t("generateMyGraph")}
          </Link>
        </div>
        <CareerGraph height={460} />
      </section>
    </main>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={"inline-block h-1.5 w-1.5 rounded-full " + dot} />
      {label}
    </span>
  );
}

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
