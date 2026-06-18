"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { RoleJourney } from "@/components/zeno/role-journey";
import { CareerGraph } from "@/components/zeno/career-graph";
import { api, type OrientationOut } from "@/lib/api";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orientations, setOrientations] = useState<OrientationOut[]>([]);
  const [orientation, setOrientation] = useState<string>("base");

  // Load the available target orientations (base + modifiers) for the selector.
  // Failure is non-fatal: the flow falls back to the default "base" orientation.
  useEffect(() => {
    let cancelled = false;
    api
      .skills()
      .then((cat) => {
        if (!cancelled && cat.orientations?.length) setOrientations(cat.orientations);
      })
      .catch(() => {
        /* keep default base; backend may be down — handled on map click */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function mapCareer() {
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await api.createSession(orientation);
      router.push(`/skills?session=${session_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法创建会话，请确认后端已启动");
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
          <SparkIcon /> AI Career Intelligence for engineers
        </motion.span>

        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-7 max-w-4xl pb-3 text-5xl font-extrabold leading-tight tracking-tight text-gradient sm:text-7xl"
        >
          See where you are.
          <br />
          Navigate where you could go.
        </motion.h1>

        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
        >
          Zeno maps your skills into a living career constellation — revealing your
          strengths, your gaps, and the most effective path to your target role.
        </motion.p>

        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-9 flex items-center gap-3"
        >
          <Button size="lg" variant="solid" onClick={mapCareer} disabled={loading}>
            {loading ? "Mapping..." : "Map my career →"}
          </Button>
          <Link href="/#graph">
            <Button size="lg" variant="outline">
              Explore the graph
            </Button>
          </Link>
        </motion.div>
        {error && <p className="mt-3 text-sm text-magenta">{error}</p>}

        {orientations.length > 1 && (
          <motion.div
            custom={3.5}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mt-8 w-full max-w-xl"
          >
            <p className="mb-2.5 text-xs uppercase tracking-wide text-muted-foreground">
              目标方向
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {orientations.map((o) => {
                const selected = o.id === orientation;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOrientation(o.id)}
                    title={o.description}
                    aria-pressed={selected}
                    className={
                      "rounded-full border px-4 py-2 text-sm transition-all " +
                      (selected
                        ? "border-cyan/70 bg-cyan/10 text-cyan"
                        : "border-border bg-surface/60 text-foreground hover:border-primary/50 hover:bg-surface")
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              {orientations.find((o) => o.id === orientation)?.description}
            </p>
          </motion.div>
        )}

        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-16 w-full max-w-4xl"
        >
          <RoleJourney current="Frontend Engineer" target="AI Engineer" progress={0.4} />
        </motion.div>
      </section>

      {/* Career graph below the fold */}
      <section id="graph" className="container relative mt-20 pb-28">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Your career constellation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Legend dot="bg-cyan" label="已掌握" /> ·{" "}
              <Legend dot="bg-gold" label="进行中 / 目标" /> ·{" "}
              <Legend dot="bg-magenta" label="能力缺口" /> — 点击节点查看路径
            </p>
          </div>
          <Link href="/skills" className="hidden text-sm text-cyan hover:underline sm:block">
            生成我的专属图谱 →
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
        fill="hsl(187 100% 50%)"
      />
    </svg>
  );
}
