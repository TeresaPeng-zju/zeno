"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import type { Edge, Node } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CareerGraph, type ZenoNodeData } from "@/components/zeno/career-graph";
import { CircularProgress } from "@/components/zeno/circular-progress";
import { RoleJourney } from "@/components/zeno/role-journey";
import { Centered } from "@/components/site/centered";
import { api, CATEGORY_LABELS, type ResourceOut, type ResultResponse, type TimeBudget } from "@/lib/api";

const LEVEL_LABELS = ["未接触", "入门", "可独立做", "可交付", "可设计治理"];

function buildGraph(data: ResultResponse): { nodes: Node<ZenoNodeData>[]; edges: Edge[] } {
  const nodes: Node<ZenoNodeData>[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: "cur", type: "role", position: { x: 0, y: 190 }, data: { label: "前端工程师", kind: "role-current" } });
  nodes.push({ id: "tgt", type: "role", position: { x: 780, y: 190 }, data: { label: "AI Engineer", kind: "role-target" } });

  const haves = data.strengths.slice(0, 4);
  haves.forEach((s, i) => {
    const id = `have-${s.skill_id}`;
    nodes.push({
      id,
      type: "skill",
      position: { x: 250, y: 40 + i * 110 },
      data: { label: s.skill_name, kind: "skill", status: "have", sub: `L${s.level}` },
    });
    edges.push({ id: `e-cur-${id}`, source: "cur", target: id });
  });

  const steps = data.next_steps.slice(0, 3);
  const stepIds = new Set(steps.map((s) => s.skill_id));
  steps.forEach((s, i) => {
    const id = `step-${s.skill_id}`;
    nodes.push({
      id,
      type: "skill",
      position: { x: 510, y: 30 + i * 95 },
      data: { label: s.skill_name, kind: "skill", status: "partial", sub: `#${s.rank}` },
    });
    edges.push({ id: `e-${id}-tgt`, source: id, target: "tgt" });
    if (haves[i]) edges.push({ id: `e-have-${id}`, source: `have-${haves[i].skill_id}`, target: id });
    else edges.push({ id: `e-cur-${id}`, source: "cur", target: id });
  });

  const gaps = data.gaps.filter((g) => !stepIds.has(g.skill_id)).slice(0, 3);
  gaps.forEach((g, i) => {
    const id = `gap-${g.skill_id}`;
    nodes.push({
      id,
      type: "skill",
      position: { x: 510, y: 330 + i * 80 },
      data: { label: g.skill_name, kind: "skill", status: "gap", sub: `L${g.current_level}→${g.target_level}` },
    });
    edges.push({ id: `e-${id}-tgt`, source: id, target: "tgt" });
  });

  return { nodes, edges };
}

function ResultInner() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const [data, setData] = useState<ResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<TimeBudget>("standard");
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());

  // 纯前端「标记完成」：按 session 持久化到 localStorage，不进后端、不影响 readiness
  const doneKey = sessionId ? `zeno:done:${sessionId}` : null;
  useEffect(() => {
    if (!doneKey) return;
    try {
      const raw = localStorage.getItem(doneKey);
      if (raw) setDone(new Set(JSON.parse(raw) as number[]));
    } catch {
      /* ignore */
    }
  }, [doneKey]);

  const toggleDone = (skillId: number) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      if (doneKey) {
        try {
          localStorage.setItem(doneKey, JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (!sessionId) {
      setError("缺少 session 参数");
      return;
    }
    let active = true;
    setRefreshing(true);
    api
      .result(sessionId, budget)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => active && setRefreshing(false));
    return () => {
      active = false;
    };
  }, [sessionId, budget]);

  const graph = useMemo(() => (data ? buildGraph(data) : null), [data]);

  if (error) return <Centered text={error} tone="error" />;
  if (!data || !graph) return <Centered text="正在生成你的成长路径..." />;

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-aurora" />
      <div className="container relative max-w-5xl space-y-12 py-14">
        {/* header */}
        <div className="space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">你的 AI Engineer 成长路径</h1>
            <p className="text-sm text-muted-foreground">
              基于 {data.profile.length} 项技能画像，由确定性决策引擎生成
            </p>
            {data.orientation && data.orientation !== "base" && data.orientation_label && (
              <span className="hairline mt-1 inline-flex items-center gap-1.5 rounded-full bg-cyan/10 px-3 py-1 text-xs text-cyan">
                目标方向 · {data.orientation_label}
              </span>
            )}
          </div>
          <RoleJourney current="前端工程师" target="AI Engineer" progress={data.readiness / 100} />
        </div>

        {/* readiness + graph */}
        <section id="gap" className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col items-center justify-center gap-4 py-8">
            <CircularProgress value={data.readiness} />
            <div className="flex gap-5 text-center text-xs text-muted-foreground">
              <Stat n={data.strengths.length} label="优势" tone="text-cyan" />
              <Stat n={data.gaps.length} label="缺口" tone="text-magenta" />
              <Stat n={data.next_steps.length} label="下一步" tone="text-gold" />
            </div>
          </Card>
          <div>
            <CareerGraph nodes={graph.nodes} edges={graph.edges} height={420} />
          </div>
        </section>

        {/* Section 1: strengths */}
        <Section index={1} title="你的优势" subtitle="为什么是你学这个">
          {data.strengths.length === 0 ? (
            <EmptyHint text="本轮还没采集到明显优势项，多补充一些已有经验会更准。" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.strengths.map((s, i) => (
                <Reveal key={s.skill_id} i={i}>
                  <Card className="h-full">
                    <CardContent className="flex items-start justify-between gap-4 pt-6">
                      <div className="space-y-1">
                        <p className="font-medium">{s.skill_name}</p>
                        <p className="text-sm text-muted-foreground">{s.reason}</p>
                      </div>
                      <span className="shrink-0 rounded-md border border-cyan/40 bg-cyan/10 px-2 py-0.5 text-xs font-medium text-cyan">
                        L{s.level}
                      </span>
                    </CardContent>
                  </Card>
                </Reveal>
              ))}
            </div>
          )}
        </Section>

        {/* Section 2: gaps */}
        <Section index={2} title="能力差距" subtitle="必要 / 加分">
          {data.gaps.length === 0 ? (
            <EmptyHint text="目标岗位的必要能力你已基本覆盖，继续巩固即可。" />
          ) : (
            <Card>
              <CardContent className="space-y-2.5 pt-6">
                {data.gaps.map((g) => (
                  <div key={g.skill_id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-medium " + (g.type === "required" ? "bg-magenta/15 text-magenta" : "bg-gold/15 text-gold")}>
                        {g.type === "required" ? "必要" : "加分"}
                      </span>
                      <span className="text-sm">{g.skill_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>L{g.current_level} → L{g.target_level}</span>
                      <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full bg-gradient-to-r from-magenta to-gold" style={{ width: `${(g.gap / 4) * 100}%` }} />
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </Section>

        {/* Section 3: roadmap journey */}
        <Section index={3} title="学习路线" subtitle="按时间预算展示的最高杠杆动作（按依赖排序）">
          {data.next_steps.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                已完成 <span className="font-semibold text-cyan">{data.next_steps.filter((s) => done.has(s.skill_id)).length}</span> / {data.next_steps.length} 步
              </span>
              <span className="inline-block h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-cyan transition-all duration-500"
                  style={{ width: `${(data.next_steps.filter((s) => done.has(s.skill_id)).length / data.next_steps.length) * 100}%` }}
                />
              </span>
            </div>
          )}
          <TimeBudgetBar
            budget={budget}
            onChange={setBudget}
            pacing={data.pacing}
            refreshing={refreshing}
          />
          {data.next_steps.length === 0 ? (
            <EmptyHint text="暂无需要优先攻克的动作。" />
          ) : (
            <div id="roadmap" className="relative space-y-5 pl-8">
              <span className="absolute left-[11px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-cyan via-gold to-transparent" />
              {data.next_steps.map((ns, i) => {
                const isDone = done.has(ns.skill_id);
                return (
                <Reveal key={ns.skill_id} i={i}>
                  <div className="relative">
                    <span
                      className={
                        "absolute -left-8 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-colors " +
                        (isDone
                          ? "border-cyan bg-cyan text-background shadow-[0_0_12px_hsl(183_86%_52%/0.6)]"
                          : "border-gold/60 bg-card text-gold")
                      }
                    >
                      {isDone ? (
                        <motion.svg
                          key="check"
                          initial={{ scale: 0, rotate: -20 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 15 }}
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </motion.svg>
                      ) : (
                        ns.rank
                      )}
                    </span>
                    <Card className={"transition-colors " + (isDone ? "border-cyan/50 bg-cyan/[0.03]" : "border-gold/25")}>
                      <CardContent className="space-y-4 pt-6">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                              Step {ns.rank}
                            </p>
                            {ns.est_weeks > 0 && (
                              <span className="shrink-0 rounded-md border border-cyan/40 bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-cyan">
                                预计 ~{ns.est_weeks} 周
                              </span>
                            )}
                          </div>
                          <h3 className="mt-0.5 text-base font-semibold">{ns.action_title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">{ns.why}</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">行动步骤</p>
                            <ol className="list-decimal space-y-1 pl-5 text-sm">
                              {ns.action_steps.map((s, k) => <li key={k}>{s}</li>)}
                            </ol>
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">完成标准（可提交证据）</p>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {ns.acceptance_criteria.map((c, k) => <li key={k}>{c}</li>)}
                            </ul>
                          </div>
                        </div>
                        <Resources items={ns.recommended_resources} />
                        <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                          <p className="text-xs text-muted-foreground">
                            {isDone ? "已达成上面的完成标准 ✓" : "达成上面的完成标准后，标记一下"}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleDone(ns.skill_id)}
                            className={
                              "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors " +
                              (isDone
                                ? "border-cyan/60 bg-cyan/10 text-cyan hover:bg-cyan/15"
                                : "border-border/60 text-muted-foreground hover:border-cyan/50 hover:text-cyan")
                            }
                          >
                            {isDone ? "已完成 · 点击撤销" : "标记完成"}
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </Reveal>
                );
              })}
            </div>
          )}
        </Section>

        <details className="hairline rounded-2xl bg-card/50 p-4">
          <summary className="cursor-pointer text-sm font-medium">查看完整能力画像</summary>
          <Profile data={data} />
        </details>

        <p className="text-xs text-muted-foreground">{data.note}</p>

        <div className="flex gap-3">
          <Link href="/skills"><Button variant="outline">重新评估</Button></Link>
          <Link href="/"><Button variant="ghost">返回首页</Button></Link>
        </div>
      </div>
    </main>
  );
}

function TimeBudgetBar({
  budget,
  onChange,
  pacing,
  refreshing,
}: {
  budget: TimeBudget;
  onChange: (b: TimeBudget) => void;
  pacing: ResultResponse["pacing"];
  refreshing: boolean;
}) {
  const options: { value: TimeBudget; label: string; hint: string }[] = [
    { value: "light", label: "每周 3h", hint: "聚焦少而专" },
    { value: "standard", label: "每周 6h", hint: "稳步推进" },
    { value: "intense", label: "每周 10h+", hint: "可并行多线" },
  ];
  return (
    <Card className="border-cyan/20">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">按你的时间预算校准路线</p>
          <p className="text-sm text-muted-foreground" style={{ opacity: refreshing ? 0.5 : 1 }}>
            {pacing?.summary ?? "选择每周可投入的时间，路线会即时重排。"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {options.map((o) => {
            const active = o.value === budget;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                disabled={refreshing}
                className={
                  "flex flex-col items-center rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-60 " +
                  (active
                    ? "border-cyan/60 bg-cyan/10 text-cyan"
                    : "border-border/60 text-muted-foreground hover:border-cyan/40")
                }
              >
                <span className="font-medium">{o.label}</span>
                <span className="text-[10px] opacity-80">{o.hint}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div>
      <p className={"text-lg font-bold " + tone}>{n}</p>
      <p>{label}</p>
    </div>
  );
}

function Profile({ data }: { data: ResultResponse }) {
  const byCategory = data.profile.reduce<Record<string, ResultResponse["profile"]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});
  return (
    <div className="mt-4 space-y-4">
      {Object.entries(byCategory).map(([category, skills]) => (
        <div key={category} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{CATEGORY_LABELS[category] ?? category}</p>
          {skills.map((s) => (
            <div key={s.skill_id} className="flex items-center justify-between gap-4">
              <span className="text-sm">{s.skill_name}</span>
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">L{s.level} · {LEVEL_LABELS[s.level]}</span>
                <span className="w-16 text-right text-xs text-muted-foreground">置信 {(s.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Section({ index, title, subtitle, children }: { index: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold tracking-tight"><span className="text-muted-foreground">{index}.</span> {title}</h2>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function Reveal({ children, i }: { children: React.ReactNode; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ delay: i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-6 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

function formatVerified(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function Resources({ items }: { items: ResourceOut[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="hairline rounded-xl bg-surface/40 p-3 text-xs text-muted-foreground">
        暂无通过保鲜校验的推荐资源，资源库补充后会自动出现在这里。
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">推荐资源（已通过链接保鲜校验）</p>
      <ul className="space-y-2">
        {items.map((r) => {
          const verified = formatVerified(r.last_verified_at);
          return (
            <li key={r.url}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hairline group flex items-start justify-between gap-3 rounded-xl bg-surface/40 p-3 transition-colors hover:bg-surface/70"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-cyan">{r.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">{r.platform}</span>
                    {verified && <span>核验于 {verified}</span>}
                    {r.freshness_reason && <span className="text-cyan/80">{r.freshness_reason}</span>}
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-cyan">↗</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Centered({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <main className="container flex min-h-[60vh] items-center justify-center">
      <p className={tone === "error" ? "text-magenta" : "text-muted-foreground"}>{text}</p>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<Centered text="加载中..." />}>
      <ResultInner />
    </Suspense>
  );
}
