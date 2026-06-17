"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mapCareer() {
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await api.createSession();
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
          className="mt-7 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-gradient sm:text-7xl"
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
