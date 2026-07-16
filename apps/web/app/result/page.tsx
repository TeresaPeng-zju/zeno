"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import type { Edge, Node } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type ZenoNodeData } from "@/components/zeno/career-graph";
import { CircularProgress } from "@/components/zeno/circular-progress";
import { RoleJourney } from "@/components/zeno/role-journey";
import { PassportMint } from "@/components/zeno/passport-mint";
import { Centered } from "@/components/site/centered";
import { api, type JdMatchResponse, type OrientationOut, type ProgressEvent, type ResourceOut, type ResultResponse, type StreamEvent, type TimeBudget } from "@/lib/api";

function buildGraph(
  data: ResultResponse,
  roles: { current: string; target: string },
): { nodes: Node<ZenoNodeData>[]; edges: Edge[] } {
  const nodes: Node<ZenoNodeData>[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: "cur", type: "role", position: { x: 0, y: 190 }, data: { label: roles.current, kind: "role-current" } });
  nodes.push({ id: "tgt", type: "role", position: { x: 780, y: 190 }, data: { label: roles.target, kind: "role-target" } });

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
  const t = useTranslations("result");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const locale = useLocale();
  const sessionId = params.get("session");
  const [genShare, setGenShare] = useState(false);

  // 分享：用 Canvas 手绘一张「AI DNA」分享图，生成 PNG 自动下载（不依赖外部库）
  async function downloadDna() {
    if (!data || genShare) return;
    setGenShare(true);
    try {
      await renderDnaPng({
        filename: "zeno-ai-dna.png",
        label: t("shareLabel"),
        from: t("shareFrom"),
        to: data.orientation_label || tr("aiEngineer"),
        readiness: Math.round(data.readiness),
        have: data.strengths.length,
        unlock: data.gaps.filter((g) => g.type === "required" && g.gap > 0).length,
        readinessLabel: t("shareReadiness"),
        haveLabel: t("shareHave"),
        unlockLabel: t("shareUnlock"),
        chips: data.strengths.slice(0, 5).map((s) => s.skill_name),
        tagline: t("shareTagline"),
        zippiSrc: "/icons/zippi/cheering.png",
      });
    } finally {
      setGenShare(false);
    }
  }
  const [data, setData] = useState<ResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [budget, setBudget] = useState<TimeBudget>("standard");
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  // Optional "target a specific role" override: re-scores the same profile
  // against a role's focus (e.g. a knowledge-base/RAG job) without re-taking
  // the survey. null → use the session's default (general) orientation.
  const [orientations, setOrientations] = useState<OrientationOut[]>([]);
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [voiceHead, setVoiceHead] = useState<string | null>(null);
  // 0G verifiable-inference receipt for the expression layer (null → not on 0G).
  const [verify, setVerify] = useState<{
    provider: string;
    model: string;
    request_id: string;
    provider_address: string;
    tee_verified: boolean;
  } | null>(null);

  // The roles a user can target are the same orientations the engine supports.
  useEffect(() => {
    let active = true;
    api
      .skills()
      .then((c) => active && c.orientations?.length && setOrientations(c.orientations))
      .catch(() => {
        /* non-fatal: the picker just won't render */
      });
    return () => {
      active = false;
    };
  }, []);

  // 大模型「像真人」测评：懒加载拉 /voice（无 DeepSeek key 时后端回退确定性模板）
  useEffect(() => {
    if (!sessionId) return;
    const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
    const qs = new URLSearchParams({ lang: locale });
    if (budget) qs.set("time_budget", budget);
    if (targetRole) qs.set("orientation", targetRole);
    let active = true;
    setVoice(null);
    setVoiceHead(null);
    setVerify(null);
    fetch(`${base}/api/sessions/${sessionId}/voice?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setVoice(typeof d?.voice === "string" ? d.voice : null);
        setVoiceHead(typeof d?.headline === "string" ? d.headline : null);
        setVerify(d?.verify && d.verify.request_id ? d.verify : null);
      })
      .catch(() => { /* 非致命：没有就不显示 */ });
    return () => { active = false; };
  }, [sessionId, budget, targetRole, locale]);

  // 纯前端「标记完成」：按 session 持久化到 localStorage，不进后端、不影响 readiness
  const doneKey = sessionId ? `zeno:done:${sessionId}` : null;
  useEffect(() => {
    if (!doneKey) return;
    try {
      const raw = localStorage.getItem(doneKey);
      if (raw) setDone(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, [doneKey]);

  const toggleDone = (skillId: string) => {
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

  // Progress steps from SSE stream
  const [progressSteps, setProgressSteps] = useState<ProgressEvent[]>([]);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setError(tc("missingSession"));
      return;
    }
    setRefreshing(true);

    // First load: use SSE stream for staged reveal
    // Subsequent loads (budget/orientation change): use regular API
    if (!initialLoadDone.current) {
      setProgressSteps([]);
      const cleanup = api.resultStream(
        sessionId,
        (event: StreamEvent) => {
          if (event.type === "progress") {
            setProgressSteps((prev) => [...prev, event]);
          } else if (event.type === "result") {
            setData(event.data);
            setRefreshing(false);
            initialLoadDone.current = true;
          }
        },
        (err) => {
          const msg = err.message;
          if (/\b404\b/.test(msg) || msg.includes("session not found")) {
            setExpired(true);
          } else {
            // Fallback to regular API if stream fails
            api
              .result(sessionId, budget, targetRole ?? undefined)
              .then((d) => setData(d))
              .catch((e2) => setError(e2 instanceof Error ? e2.message : tc("loadFailed")))
              .finally(() => {
                setRefreshing(false);
                initialLoadDone.current = true;
              });
          }
        },
        budget,
        targetRole ?? undefined,
      );
      return cleanup;
    } else {
      // Budget / orientation change: quick refresh via regular API
      api
        .result(sessionId, budget, targetRole ?? undefined)
        .then((d) => setData(d))
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "";
          if (/\b404\b/.test(msg) || msg.includes("session not found")) {
            setExpired(true);
          } else {
            setError(msg || tc("loadFailed"));
          }
        })
        .finally(() => setRefreshing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, budget, targetRole]);

  const graph = useMemo(
    () => (data ? buildGraph(data, { current: tr("frontend"), target: tr("aiEngineer") }) : null),
    [data, tr],
  );

  if (expired)
    return (
      <Centered tone="error" text={tc("sessionExpired")}>
        <Link href="/skills" className="mt-4 inline-block">
          <Button>{tc("restart")}</Button>
        </Link>
      </Centered>
    );
  if (error) return <Centered text={error} tone="error" />;
  if (!data || !graph)
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
        <div className="relative h-10 w-10">
          <span className="absolute inset-0 animate-ping rounded-full bg-cyan/30" />
          <span className="absolute inset-2 rounded-full bg-cyan/60" />
        </div>
        <div className="w-full max-w-xs space-y-2">
          <AnimatePresence mode="popLayout">
            {progressSteps.map((step, i) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="flex items-center gap-2.5 text-sm"
              >
                <span className={i === progressSteps.length - 1 ? "text-cyan" : "text-cyan/50"}>
                  {step.step === "done" ? "✓" : "●"}
                </span>
                <span className={i === progressSteps.length - 1 ? "text-foreground" : "text-muted-foreground"}>
                  {step.message}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {progressSteps.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">{t("generatingPath")}</p>
          )}
        </div>
      </div>
    );

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-aurora" />
      <div className="container relative max-w-5xl space-y-12 py-14">
        {/* header: 三段式主叙述 */}
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
            <p className="text-base text-muted-foreground">
              {t("headerSummary", {
                strengths: data.strengths.length,
                gaps: data.gaps.filter(g => g.type === "required" && g.gap > 0).length,
              })}
            </p>
            {data.orientation && data.orientation !== "base" && data.orientation_label && (
              <span className="hairline mt-1 inline-flex items-center gap-1.5 rounded-full bg-cyan/10 px-3 py-1 text-xs text-cyan">
                {t("orientationTag", { label: data.orientation_label })}
              </span>
            )}
            <p className="mx-auto max-w-xl pt-2 text-xs leading-relaxed text-muted-foreground/80">
              {t("honestNote")}
            </p>
          </div>

          {/* 发现行：双翼布局（青色=已有 / 品红=待解锁）+ 分层 CTA */}
          <div className="relative mx-auto max-w-2xl py-8 text-center">
            <div className="absolute inset-0 -z-10 rounded-full bg-cyan/5 blur-[120px]" />
            <div className="flex flex-col items-center justify-center gap-8 md:flex-row md:gap-16">
              <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} className="relative">
                <p className="bg-gradient-to-b from-white to-white/40 bg-clip-text text-6xl font-black tracking-tighter text-transparent sm:text-7xl">{data.strengths.length}</p>
                <span className="absolute -right-4 -top-1 animate-pulse rounded border border-cyan/40 bg-cyan/20 px-2 py-0.5 font-mono text-[10px] uppercase text-cyan">{t("discFound")}</span>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan/80">{t("discTransferable")}</p>
              </motion.div>
              <div className="hidden h-px w-12 bg-white/10 md:block" />
              <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.1 }}>
                <p className="bg-gradient-to-b from-magenta/90 to-magenta/40 bg-clip-text text-6xl font-black tracking-tighter text-transparent sm:text-7xl">{data.gaps.filter((g) => g.type === "required" && g.gap > 0).length}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-magenta/80">{t("discUnlock")}</p>
              </motion.div>
            </div>
            <p className="mt-7 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{t("discVerified", { label: data.orientation_label || t("orientationFallback") })}</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <a href={`/growth?session=${sessionId}`} className="rounded-full bg-cyan px-6 py-3 text-sm font-bold text-[hsl(222_47%_6%)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(27,229,238,0.6)] active:scale-95">
                {t("exploreCta")}
              </a>
            </div>
          </div>

          {/* 大金句 + Zippi 诊断「技术档案 / Analysis Terminal」 */}
          {(voiceHead || voice) && (
            <div className="mx-auto max-w-3xl space-y-5">
              {voiceHead && (
                <div className="space-y-1.5 text-center text-xl font-semibold leading-snug text-foreground sm:text-2xl">
                  {voiceHead.split(/(?<=[。！？])|(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean).map((line, i, arr) => (
                    <p key={i}>{i === 0 ? "“" : ""}{line}{i === arr.length - 1 ? "”" : ""}</p>
                  ))}
                </div>
              )}
              {voice && (
                <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.5 }}
                  className="overflow-hidden rounded-3xl border border-white/10 bg-[#121826]/60 backdrop-blur-xl">
                  {/* 顶部仪器状态条 */}
                  <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-cyan shadow-[0_0_8px_#1BE5EE]" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan/70">Analysis Terminal // Zeno</span>
                    </div>
                    {verify?.tee_verified ? (
                      <span
                        title={`${t("zgVerifiedTip")} · ${verify.model} · ${verify.request_id}${verify.provider_address ? ` · ${verify.provider_address}` : ""}`}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300/90"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                        {t("zgVerified")} · {verify.request_id.slice(0, 10)}…
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">{t("termStatus")}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-6 p-7 md:flex-row md:gap-8">
                    {/* 左：Zippi + 就绪度微型仪表 */}
                    <div className="flex shrink-0 flex-col items-center gap-4 md:w-32">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-cyan/20 blur-2xl" />
                        <img src="/icons/zippi/thinking.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }} className="relative z-10 h-20 w-20" style={{ imageRendering: "pixelated" }} alt="Zippi" />
                      </div>
                      <div className="text-center">
                        <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-slate-500">{t("termReady")}</p>
                        <p className="text-3xl font-black italic text-white">{Math.round(data.readiness)}<span className="text-sm text-cyan">%</span></p>
                        <div className="mx-auto mt-2 h-1 w-16 overflow-hidden rounded-full bg-white/10">
                          <motion.div initial={{ width: 0 }} whileInView={{ width: `${Math.round(data.readiness)}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.3 }} className="h-full bg-cyan shadow-[0_0_8px_#1BE5EE]" />
                        </div>
                        <p className="mt-2 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-slate-400">
                          {t("profileConfidence", { level: data.profile_uncertainty <= 0.2 ? t("confidenceHigh") : data.profile_uncertainty <= 0.45 ? t("confidenceMedium") : t("confidencePreliminary") })}
                        </p>
                      </div>
                    </div>
                    {/* 右：诊断正文 + 缺口 code 标签 + 数据背书 */}
                    <div className="min-w-0 flex-1 space-y-5">
                      <div className="space-y-4 text-[15px] leading-relaxed text-slate-200">
                        {voice.split(/\n\s*\n/).map((para, i) => (<p key={i}>{para.trim()}</p>))}
                      </div>
                      {data.gaps.filter((g) => g.type === "required" && g.gap > 0).length > 0 && (
                        <div className="relative rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                          <div className="absolute -left-1 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-magenta" />
                          <p className="mb-2 text-xs text-slate-400">{t("termGaps")}</p>
                          <div className="flex flex-wrap gap-2">
                            {data.gaps.filter((g) => g.type === "required" && g.gap > 0).slice(0, 5).map((g) => (
                              <code key={g.skill_id} className="rounded border border-magenta/20 bg-magenta/10 px-2 py-1 font-mono text-xs text-magenta">{g.skill_name}</code>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-start gap-2 border-t border-white/5 pt-4">
                        <span className="text-lg leading-none text-gold">&ldquo;</span>
                        <p className="text-xs italic leading-relaxed text-slate-500">{t.rich("termBacking", { count: 759, u: (c) => <span className="text-slate-300 underline underline-offset-4">{c}</span> })}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
          {/* ── Journey Spine：从工程到 AI 的唯一叙事过渡层（少讲·慢亮·往前走） ── */}
          <JourneySpine sessionId={sessionId} />
        </div>

        {/* Career Graph 与中段默认 Share 卡已移除：图谱与 strengths/gaps/roadmap 重复表达；
            分享改为页面底部的「结果动作」，由按钮触发，不再占用中段主视觉。 */}

        {/* Section 1: strengths（已迁移能力 · 降级为只展示 3 张 + 细节折叠） */}
        <Section index={1} title={t("section1Title")} subtitle={t("section1Subtitle")}>
          {data.strengths.length === 0 ? (
            <EmptyHint text={t("section1Empty")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {data.strengths.slice(0, 3).map((s, i) => (
                <Reveal key={s.skill_id} i={i}>
                  <div className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/30 hover:shadow-[0_8px_30px_-12px_rgba(27,229,238,0.25)]">
                    {/* 网格底纹 */}
                    <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(27,229,238,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(27,229,238,0.6)_1px,transparent_1px)] [background-size:22px_22px]" />
                    {/* hover 底部流光 */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative space-y-3">
                      {/* 微标：档位语义 + L 等级 */}
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan/50">
                          {s.level >= 3 ? t("inferStrong") : t("inferTransferable")}
                        </span>
                        <span className="font-mono text-[9px] tracking-wider text-muted-foreground/40">L{s.level}</span>
                      </div>
                      {/* 技能名 + 青色 accent bar */}
                      <div className="flex items-center gap-2.5">
                        <span className="h-4 w-[3px] shrink-0 rounded-full bg-cyan shadow-[0_0_8px_rgba(27,229,238,0.6)]" />
                        <p className="text-sm font-semibold tracking-tight">{s.skill_name}</p>
                      </div>
                      {/* 一句理由 */}
                      <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>
                      {/* 三段式：AI里怎么用 + 不能覆盖什么 */}
                      {s.ai_usage?.length > 0 && (
                        <details className="group/d">
                          <summary className="cursor-pointer list-none text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1 select-none">
                            <span className="group-open/d:hidden">↓ {t("expandUsage")}</span>
                            <span className="hidden group-open/d:inline">↑ {t("collapseEvidence")}</span>
                          </summary>
                          <div className="mt-2 space-y-2 border-t border-border/20 pt-2">
                            <div>
                              <p className="text-[10px] font-medium text-cyan/70 uppercase tracking-wide mb-1">{t("aiUsageLabel")}</p>
                              <ul className="space-y-0.5">
                                {s.ai_usage.map((u, j) => (
                                  <li key={j} className="text-xs text-muted-foreground leading-relaxed">· {u}</li>
                                ))}
                              </ul>
                            </div>
                            {s.non_ai_boundaries?.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-amber-400/70 uppercase tracking-wide mb-1">{t("boundaryLabel")}</p>
                                <ul className="space-y-0.5">
                                  {s.non_ai_boundaries.map((b, j) => (
                                    <li key={j} className="text-xs text-muted-foreground/70 leading-relaxed">· {b}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </Section>

        {/* Section 2: gaps */}
        <Section index={2} title={t("section2Title")} subtitle={t("section2Subtitle")}>
          {data.gaps.length === 0 ? (
            <EmptyHint text={t("section2Empty")} />
          ) : (
            <GapsGrid gaps={data.gaps} />
          )}
        </Section>

        {/* 能力资产组合 · 金融视角(把路线图讲成"按 ROI 配置你的时间") */}
        <Reveal>
          <CapabilityPortfolio data={data} />
        </Reveal>

        {/* Section 3: roadmap journey */}
        <Section index={3} title={t("section3Title")} subtitle={t("section3Subtitle")}>
          {data.next_steps.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t.rich("stepsDone", {
                  done: data.next_steps.filter((s) => done.has(s.skill_id)).length,
                  total: data.next_steps.length,
                  c: (chunks) => <span className="font-semibold text-cyan">{chunks}</span>,
                })}
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
            <EmptyHint text={t("section3Empty")} />
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
                              {t("step", { rank: ns.rank })}
                            </p>
                            {ns.est_weeks > 0 && (
                              <span className="shrink-0 rounded-md border border-cyan/40 bg-cyan/10 px-2 py-0.5 text-[11px] font-medium text-cyan">
                                {t("estWeeks", { weeks: ns.est_weeks })}
                              </span>
                            )}
                          </div>
                          <h3 className="mt-0.5 text-base font-semibold">{ns.action_title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">{ns.why}</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("actionSteps")}</p>
                            <ol className="list-decimal space-y-1 pl-5 text-sm">
                              {ns.action_steps.map((s, k) => <li key={k}>{s}</li>)}
                            </ol>
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("acceptanceCriteria")}</p>
                            <ul className="list-disc space-y-1 pl-5 text-sm">
                              {ns.acceptance_criteria.map((c, k) => <li key={k}>{c}</li>)}
                            </ul>
                          </div>
                        </div>
                        <Resources items={ns.recommended_resources} />
                        <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
                          <p className="text-xs text-muted-foreground">
                            {isDone ? t("doneMet") : t("doneHint")}
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
                            {isDone ? t("doneUndo") : t("markDone")}
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

        <TargetRoleSection
          available={orientations.length > 1}
          refreshing={refreshing}
          onPick={setTargetRole}
        />

        <p className="text-xs text-muted-foreground">{data.note}</p>

        {/* ── 底部结果动作：保存 / 分享（分享是结果动作，不再占中段主视觉）── */}
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/[0.06] pt-8">
          <button onClick={downloadDna} disabled={genShare} className="rounded-full bg-cyan px-6 py-2.5 text-sm font-bold text-[hsl(222_47%_6%)] transition-all hover:scale-105 hover:shadow-[0_0_24px_rgba(27,229,238,0.5)] active:scale-95 disabled:opacity-60">
            {genShare ? t("generatingImage") : t("shareCta")}
          </button>
          <button onClick={() => window.print()} className="rounded-full border border-white/12 bg-white/[0.03] px-6 py-2.5 text-sm text-foreground transition-all hover:border-cyan/40 hover:bg-white/[0.06]">
            {t("saveMap")}
          </button>
          <Link href="/"><Button variant="outline">{t("reassess")}</Button></Link>
          {/* AI×Web3: mint the migration journey as a Soulbound passport.
              Hidden unless NEXT_PUBLIC_PASSPORT_ADDRESS is configured. */}
          <PassportMint
            fromRole={tr("frontend")}
            toRole={tr("aiEngineer")}
            chainFromRole="Frontend Engineer"
            chainToRole="AI Application Engineer"
            readiness={Math.round(data.readiness)}
            strengths={data.strengths.length}
            gaps={data.gaps.filter((g) => g.type === "required" && g.gap > 0).length}
          />
        </div>
      </div>
    </main>
  );
}

function TargetRoleSection({
  available,
  refreshing,
  onPick,
}: {
  available: boolean;
  refreshing: boolean;
  onPick: (id: string | null) => void;
}) {
  const t = useTranslations("result");
  const [jd, setJd] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [match, setMatch] = useState<JdMatchResponse | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Hidden unless the engine actually supports >1 orientation to map a JD onto.
  if (!available) return null;

  async function analyze() {
    if (!jd.trim()) {
      setMatch(null);
      setHint(t("targetEmpty"));
      return;
    }
    setHint(null);
    setAnalyzing(true);
    try {
      const m = await api.matchOrientation(jd);
      setMatch(m);
      // A confident specialty → re-score against it; otherwise stay general.
      onPick(m.matched ? m.orientation : null);
    } catch {
      setHint(t("targetEmpty"));
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() {
    setJd("");
    setMatch(null);
    setHint(null);
    onPick(null);
  }

  const busy = analyzing || refreshing;

  return (
    <Card className="border-cyan/20">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{t("targetTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("targetSubtitle")}</p>
        </div>

        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          disabled={busy}
          rows={4}
          placeholder={t("targetPlaceholder")}
          className="w-full resize-y rounded-xl border border-border bg-surface/60 p-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-cyan/60 disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={analyze}
            disabled={busy}
            className="rounded-full border border-cyan/70 bg-cyan/10 px-4 py-2 text-sm text-cyan transition-all hover:bg-cyan/15 disabled:opacity-60"
          >
            {analyzing ? t("targetAnalyzing") : refreshing ? t("targetRecomputing") : t("targetAnalyze")}
          </button>
          {(match || jd) && (
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-full border border-border bg-surface/60 px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-surface disabled:opacity-60"
            >
              {t("targetReset")}
            </button>
          )}
        </div>

        {hint && <p className="text-xs text-magenta">{hint}</p>}

        {match && !analyzing && (
          match.matched ? (
            <div className="space-y-1.5 rounded-xl border border-cyan/30 bg-cyan/[0.06] p-3">
              <p className="text-sm text-foreground">
                {t.rich("targetMatched", {
                  label: match.orientation_label,
                  b: (chunks) => <span className="font-semibold text-cyan">{chunks}</span>,
                })}
              </p>
              {match.signals.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("targetSignals", { signals: match.signals.slice(0, 8).join("、") })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {refreshing ? t("targetRecomputing") : t("targetMatchedHint")}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("targetNoMatch")}</p>
          )
        )}
      </CardContent>
    </Card>
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
  const t = useTranslations("result");
  const options: { value: TimeBudget; label: string; hint: string }[] = [
    { value: "light", label: t("budgetLight"), hint: t("budgetLightHint") },
    { value: "standard", label: t("budgetStandard"), hint: t("budgetStandardHint") },
    { value: "intense", label: t("budgetIntense"), hint: t("budgetIntenseHint") },
  ];
  return (
    <Card className="border-cyan/20">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{t("calibrateTitle")}</p>
          <p className="text-sm text-muted-foreground" style={{ opacity: refreshing ? 0.5 : 1 }}>
            {pacing?.summary ?? t("calibrateDefault")}
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
  const t = useTranslations("result");
  const tcat = useTranslations("categories");
  const tlv = useTranslations("levels");
  const byCategory = data.profile.reduce<Record<string, ResultResponse["profile"]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});
  return (
    <div className="mt-4 space-y-4">
      {Object.entries(byCategory).map(([category, skills]) => (
        <div key={category} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{tcat.has(category) ? tcat(category) : category}</p>
          {skills.map((s) => (
            <div key={s.skill_id} className="flex items-center justify-between gap-4">
              <span className="text-sm">{s.skill_name}</span>
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">L{s.level} · {tlv(String(s.level))}</span>
                <span className="w-16 text-right text-xs text-muted-foreground">{t("confidence", { percent: (s.confidence * 100).toFixed(0) })}</span>
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

function Reveal({ children, i = 0 }: { children: React.ReactNode; i?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ delay: i * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* Journey Spine：能力生长链（技术术语，中英通用） */
const GROWTH_CHAIN = ["TypeScript", "API", "Streaming", "Prompt", "Tool Use", "Agent"];

/* 独立子组件：useScroll 的 target ref 与组件同生命周期，元素永远已挂载，避免 "ref defined but not hydrated" */
function JourneySpine({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations("result");
  const spineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: spineRef, offset: ["start center", "end center"] });
  const lineScale = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  return (
    <div ref={spineRef} className="relative mx-auto max-w-xl pl-9">
      {/* 生长中轴线：随滚动一截截长出来 */}
      <div className="absolute bottom-3 left-[13px] top-3 w-[2px] overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div style={{ scaleY: lineScale, originY: 0 }} className="absolute inset-0 bg-gradient-to-b from-cyan via-magenta to-gold shadow-[0_0_10px_#1BE5EE]" />
      </div>

      {/* 段 1 · 起点 */}
      <JourneyStep dot="cyan">
        <h3 className="text-lg font-bold text-cyan">{t("journeyS1Head")}</h3>
        <p className="mt-0.5 text-sm font-medium text-foreground/90">{t("journeyS1Sub")}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("journeyS1Note")}</p>
      </JourneyStep>

      {/* 段 2 · 生长链（不再用 chips，而是顺序点亮的能力链） */}
      <JourneyStep dot="cyan">
        <h3 className="text-lg font-bold text-cyan">{t("journeyS2Head")}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-y-2">
          {GROWTH_CHAIN.map((node, idx) => (
            <span key={node} className="inline-flex items-center">
              {idx > 0 && <span className="mx-1.5 text-xs text-muted-foreground/40">→</span>}
              <motion.span
                initial={{ opacity: 0.2, scale: 0.94 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: 0.12 * idx, duration: 0.4 }}
                className={"rounded-md border px-2 py-1 text-xs font-medium " + (node === "Prompt" ? "border-magenta/50 bg-magenta/10 text-magenta shadow-[0_0_12px_rgba(255,77,141,0.4)]" : "border-cyan/25 bg-cyan/[0.06] text-foreground/85")}
              >
                {node}
              </motion.span>
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("journeyS2Note")}</p>
      </JourneyStep>

      {/* 段 3 · Prompt 优先 */}
      <JourneyStep dot="magenta">
        <h3 className="text-lg font-bold text-magenta">{t("journeyS3Head")}</h3>
        <p className="mt-0.5 text-sm font-medium text-foreground/90">{t("journeyS3Sub")}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("journeyS3Note")}</p>
      </JourneyStep>

      {/* 段 4 · 行动收口（剧情落到第一步 CTA） */}
      <JourneyStep dot="gold" last>
        <h3 className="text-lg font-bold text-gold">{t("journeyS4Head")}</h3>
        <p className="mt-0.5 text-sm font-medium text-foreground/90">{t("journeyS4Sub")}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("journeyS4Note")}</p>
        <a href={`/growth?session=${sessionId}`} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-[hsl(222_47%_6%)] transition-all hover:scale-105 hover:shadow-[0_0_24px_rgba(255,184,0,0.5)] active:scale-95">
          {t("journeyCta")}
        </a>
      </JourneyStep>
    </div>
  );
}

function JourneyStep({ children, dot, last }: { children: React.ReactNode; dot: "cyan" | "magenta" | "gold"; last?: boolean }) {
  const ping = dot === "magenta" ? "bg-magenta/50" : dot === "gold" ? "bg-gold/50" : "bg-cyan/50";
  const core = dot === "magenta" ? "bg-magenta/30 shadow-[0_0_14px_rgba(255,77,141,0.6)]"
    : dot === "gold" ? "bg-gold/40 shadow-[0_0_14px_rgba(255,184,0,0.6)]"
    : "bg-cyan/20 shadow-[0_0_14px_rgba(27,229,238,0.6)]";
  const border = dot === "magenta" ? "border-magenta" : dot === "gold" ? "border-gold" : "border-cyan";
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, filter: "blur(10px)", scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={"relative " + (last ? "" : "pb-12")}
    >
      <span className="absolute -left-9 top-1 flex h-6 w-6 items-center justify-center">
        <span className={"absolute inset-0 animate-ping rounded-full opacity-40 " + ping} />
        <span className={"relative h-3.5 w-3.5 rounded-full border-2 border-[#0A0D14] " + border + " " + core} />
      </span>
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

// 真差距 → 分领域便当格 + "点亮星星"的 Leap 可视化（青已有 / 品红待补 / 金加分）
const GAP_CAT_NAMES: Record<string, string> = {
  data: "RAG & Retrieval",
  llm: "Prompt, Tools & Agents",
  eval: "Evaluation & Ops",
  foundation: "Engineering Foundation",
};
const GAP_CAT_ORDER = ["data", "llm", "eval", "foundation"];

function GapCard({ g }: { g: ResultResponse["gaps"][number] }) {
  const isCore = g.type === "required";
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-magenta/30 hover:bg-white/[0.05]"
    >
      <div className="mb-3 flex items-start justify-between">
        <span className={"rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tighter " + (isCore ? "border border-magenta/20 bg-magenta/10 text-magenta" : "border border-gold/20 bg-gold/10 text-gold")}>
          {isCore ? "Core" : "Bonus"}
        </span>
        <div className="flex gap-1">
          {[1, 2, 3].map((step) => (
            <div
              key={step}
              className={"h-1.5 w-1.5 rotate-45 rounded-sm transition-colors " +
                (step <= g.target_level
                  ? (step <= g.current_level ? "bg-white/20" : (isCore ? "bg-magenta shadow-[0_0_8px_#FF4D8D]" : "bg-gold shadow-[0_0_8px_#FFB800]"))
                  : "border border-white/10")}
            />
          ))}
        </div>
      </div>
      <h4 className="text-sm font-semibold text-slate-200 transition-colors group-hover:text-white">{g.skill_name}</h4>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase text-slate-500">Leap</span>
        <span className="font-mono text-xs text-slate-300">L{g.current_level}</span>
        <span className="text-[10px] text-slate-600">→</span>
        <span className={"font-mono text-xs font-bold " + (isCore ? "text-magenta" : "text-gold")}>L{g.target_level}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-magenta/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </motion.div>
  );
}

const TOP_GAPS = 6;

/* 能力资产组合 / Human Capital Portfolio：把成长路线图讲成"按 ROI 配置你的时间"(金融视角) */
function CapabilityPortfolio({ data }: { data: ResultResponse }) {
  const t = useTranslations("result");
  const steps = data.next_steps.slice(0, 4);
  if (steps.length === 0) return null;
  const totalW = steps.reduce((s, x) => s + Math.max(1, x.est_weeks), 0);
  const weeks = data.pacing?.total_weeks ?? totalW;
  const COLORS = ["#1BE5EE", "#FFB800", "#FF4D8D", "#00C896"];
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#121826]/50 p-6 backdrop-blur-xl sm:p-8">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan/70">Human Capital Portfolio</span>
      <h3 className="mt-1 text-lg font-bold tracking-tight">{t("portfolioTitle")}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("portfolioSubtitle")}</p>

      {data.strengths.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{t("portfolioHave")}</p>
          <div className="flex flex-wrap gap-1.5">
            {data.strengths.slice(0, 5).map((s) => (
              <span key={s.skill_id} className="rounded-full border border-cyan/25 bg-cyan/[0.06] px-2.5 py-0.5 text-xs text-foreground/85">{s.skill_name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{t("portfolioAllocation", { weeks })}</p>
        <div className="space-y-3.5">
          {steps.map((x, i) => {
            const pct = Math.round((Math.max(1, x.est_weeks) / totalW) * 100);
            const c = COLORS[i % COLORS.length];
            return (
              <div key={x.skill_id}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{x.skill_name}</span>
                  <span className="shrink-0 font-mono text-sm font-bold" style={{ color: c }}>{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${pct}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.1 * i, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full rounded-full"
                    style={{ background: c, boxShadow: `0 0 10px ${c}80` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GapsGrid({ gaps }: { gaps: ResultResponse["gaps"] }) {
  const t = useTranslations("result");
  const [expanded, setExpanded] = useState(false);
  // 折叠态：核心缺口优先、差距大的靠前，只露 Top 6，降低认知负担与负反馈
  const sorted = [...gaps].sort((a, b) =>
    (Number(b.type === "required") - Number(a.type === "required")) || (b.gap - a.gap));
  const hidden = Math.max(0, gaps.length - TOP_GAPS);
  const byCat: Record<string, ResultResponse["gaps"]> = {};
  for (const g of gaps) (byCat[g.category] ??= []).push(g);
  const cats = [...GAP_CAT_ORDER.filter((c) => byCat[c]?.length), ...Object.keys(byCat).filter((c) => !GAP_CAT_ORDER.includes(c))];
  return (
    <div className="space-y-6">
      {expanded ? (
        <div className="space-y-10">
          {cats.map((cat) => (
            <div key={cat} className="space-y-4">
              <div className="flex items-center gap-4">
                <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">{GAP_CAT_NAMES[cat] ?? cat}</h3>
                <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {byCat[cat].map((g) => <GapCard key={g.skill_id} g={g} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.slice(0, TOP_GAPS).map((g) => <GapCard key={g.skill_id} g={g} />)}
        </div>
      )}
      {hidden > 0 && (
        <div className="text-center">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-xs text-muted-foreground transition-all hover:border-magenta/40 hover:text-magenta"
          >
            {expanded ? t("gapsShowLess") : t("gapsShowMore", { count: hidden })}
          </button>
        </div>
      )}
    </div>
  );
}

function formatVerified(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function Resources({ items }: { items: ResourceOut[] }) {
  const t = useTranslations("result");
  const locale = useLocale();
  if (!items || items.length === 0) {
    return (
      <div className="hairline rounded-xl bg-surface/40 p-3 text-xs text-muted-foreground">
        {t("resourcesEmpty")}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{t("resourcesTitle")}</p>
      <ul className="space-y-2">
        {items.map((r) => {
          const verified = formatVerified(r.last_verified_at, locale);
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
                    {verified && <span>{t("verifiedOn", { date: verified })}</span>}
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

export default function ResultPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<Centered text={tc("loading")} />}>
      <ResultInner />
    </Suspense>
  );
}

/* ── 「AI DNA」分享图：纯 Canvas 手绘 → 导出 PNG 自动下载 ───────────── */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderDnaPng(o: {
  filename: string; label: string; from: string; to: string;
  readiness: number; have: number; unlock: number;
  readinessLabel: string; haveLabel: string; unlockLabel: string;
  chips: string[]; tagline: string; zippiSrc: string;
}) {
  const W = 1200, H = 675, S = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(S, S);
  try { await document.fonts?.ready; } catch { /* 字体加载失败也继续 */ }

  const FONT = '"Plus Jakarta Sans","Noto Sans SC",system-ui,sans-serif';

  // 背景渐变 + 两角辉光
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0E1320");
  bg.addColorStop(1, "#0A0D14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W - 130, 90, 0, W - 130, 90, 440);
  g1.addColorStop(0, "rgba(27,229,238,0.20)");
  g1.addColorStop(1, "rgba(27,229,238,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(130, H - 70, 0, 130, H - 70, 440);
  g2.addColorStop(0, "rgba(255,77,141,0.16)");
  g2.addColorStop(1, "rgba(255,77,141,0)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // 细网格
  ctx.strokeStyle = "rgba(27,229,238,0.05)";
  ctx.lineWidth = 1;
  for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // 外框
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, 16, 16, W - 32, H - 32, 28);
  ctx.stroke();

  // 顶部：标识 + ZENO
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(27,229,238,0.75)";
  ctx.fillText(o.label.toUpperCase(), 56, 76);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(230,234,242,0.5)";
  ctx.fillText("ZENO", W - 56, 76);

  // From → To
  ctx.font = `800 42px ${FONT}`;
  const sep = "   →   ";
  const fromW = ctx.measureText(o.from).width;
  const sepW = ctx.measureText(sep).width;
  const toW = ctx.measureText(o.to).width;
  let x0 = (W - (fromW + sepW + toW)) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1BE5EE"; ctx.fillText(o.from, x0, 200); x0 += fromW;
  ctx.fillStyle = "rgba(230,234,242,0.4)"; ctx.fillText(sep, x0, 200); x0 += sepW;
  ctx.fillStyle = "#FFB800"; ctx.fillText(o.to, x0, 200);

  // 三个大数字
  const cols = [
    { n: `${o.readiness}%`, c: "#FFFFFF", label: o.readinessLabel },
    { n: `${o.have}`, c: "#1BE5EE", label: o.haveLabel },
    { n: `${o.unlock}`, c: "#FF4D8D", label: o.unlockLabel },
  ];
  const colW = W / 3;
  cols.forEach((col, i) => {
    const cx = colW * i + colW / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = col.c;
    ctx.font = `800 76px ${FONT}`;
    ctx.fillText(col.n, cx, 360);
    ctx.fillStyle = "rgba(230,234,242,0.55)";
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(col.label.toUpperCase(), cx, 396);
  });

  // 优势 chips（一行，超宽自动减少）
  ctx.font = `500 17px ${FONT}`;
  const padX = 18, gap = 10, chipH = 38, chipY = 462;
  let chips = o.chips.slice();
  const widthsOf = (arr: string[]) => arr.map((c) => ctx.measureText(c).width + padX * 2);
  const totalOf = (arr: string[]) => widthsOf(arr).reduce((a, b) => a + b, 0) + gap * Math.max(0, arr.length - 1);
  while (chips.length > 1 && totalOf(chips) > W - 120) chips = chips.slice(0, -1);
  const ws = widthsOf(chips);
  let cx2 = (W - totalOf(chips)) / 2;
  chips.forEach((c, i) => {
    const w = ws[i];
    ctx.fillStyle = "rgba(27,229,238,0.07)";
    ctx.strokeStyle = "rgba(27,229,238,0.28)";
    ctx.lineWidth = 1;
    roundRectPath(ctx, cx2, chipY, w, chipH, chipH / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(230,234,242,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c, cx2 + w / 2, chipY + chipH / 2 + 1);
    ctx.textBaseline = "alphabetic";
    cx2 += w + gap;
  });

  // 底部 tagline + Zippi
  ctx.fillStyle = "rgba(230,234,242,0.45)";
  ctx.font = `500 14px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(o.tagline, 56, H - 46);
  try {
    const zip = await loadImage(o.zippiSrc);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(zip, W - 116, H - 108, 60, 60);
  } catch { /* Zippi 加载失败就不画 */ }

  // 导出并自动下载
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = o.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      resolve();
    }, "image/png");
  });
}
