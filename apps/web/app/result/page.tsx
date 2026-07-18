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

type VoiceSections = {
  summary: string;
  primary_gap: string;
  next_action: string;
  honest_note: string;
};

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
  const isChinese = locale.startsWith("zh");
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
  const [voiceSections, setVoiceSections] = useState<VoiceSections | null>(null);
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
    fetch(`${base}/api/sessions/${sessionId}/voice?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const nextVoice = typeof d?.voice === "string" ? d.voice : null;
        const sections = d?.sections;
        const nextSections = (
          sections && ["summary", "primary_gap", "next_action", "honest_note"].every((key) => typeof sections[key] === "string" && sections[key].trim())
            ? sections as VoiceSections
            : null
        );
        const nextVerify = d?.verify && d.verify.request_id ? d.verify : null;
        setVoice(nextVoice);
        setVoiceSections(nextSections);
        setVerify(nextVerify);
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
  const [loadingProgress, setLoadingProgress] = useState(12);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const initialLoadDone = useRef(Boolean(data));

  useEffect(() => {
    if (data) {
      setShowSlowHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSlowHint(true), 4500);
    return () => window.clearTimeout(timer);
  }, [data]);

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
      setLoadingProgress((previous) => Math.max(previous, 12));
      setShowSlowHint(false);
      const cleanup = api.resultStream(
        sessionId,
        (event: StreamEvent) => {
          if (event.type === "progress") {
            setProgressSteps((prev) => [...prev, event]);
            const progressByStep: Record<ProgressEvent["step"], number> = {
              profile: 18,
              strengths: 32,
              gaps: 48,
              roadmap: 64,
              resources: 86,
              done: 96,
            };
            setLoadingProgress((previous) => Math.max(previous, progressByStep[event.step] ?? previous));
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
  }, [sessionId, budget, targetRole, locale]);

  const graph = useMemo(
    () => (data ? buildGraph(data, { current: tr("frontend"), target: tr("aiEngineer") }) : null),
    [data, tr],
  );
  const loadingMessage = progressSteps.at(-1)?.message ?? t("generatingPath");

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
        <div className="w-full max-w-sm space-y-3">
          <AnimatePresence mode="wait">
            <motion.p
              key={loadingMessage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-center text-sm text-muted-foreground"
            >
              {loadingMessage}
            </motion.p>
          </AnimatePresence>
          <div className="h-1.5 overflow-hidden rounded-full border border-cyan/10 bg-white/[0.04] shadow-[inset_0_0_12px_rgba(27,229,238,0.06)]">
            <motion.div
              className="relative h-full rounded-full bg-gradient-to-r from-cyan/70 to-cyan shadow-[0_0_14px_rgba(27,229,238,0.65)]"
              initial={false}
              animate={{ width: `${loadingProgress}%` }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              <span className="absolute inset-y-0 right-0 w-10 animate-pulse bg-gradient-to-r from-transparent to-white/60" />
            </motion.div>
          </div>
          <p className="text-center font-mono text-[10px] tracking-[0.18em] text-cyan/55">{loadingProgress}%</p>
          <AnimatePresence>
            {showSlowHint && loadingProgress >= 64 && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center text-xs leading-relaxed text-muted-foreground/70">
                {t("firstLoadHint")}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    );

  const primaryStep = data.next_steps[0] ?? null;
  const remainingEvidence = Math.max(0, data.required_skill_count - data.assessed_required_count);
  const currentCoverage = Math.round(data.readiness);
  const projectedCoverage = Math.round(data.projected_readiness);
  const weeklyHours = data.pacing?.weekly_hours ?? 6;
  const totalWeeks = data.pacing?.total_weeks ?? data.next_steps.reduce((sum, step) => sum + step.est_weeks, 0);

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-aurora" />
      <div className="container relative max-w-5xl space-y-12 py-14">
        {/* Hero：只回答“我现在在哪里、下一步是什么、多久能推进”。 */}
        <div className="space-y-12">
          <section className="relative mx-auto flex min-h-[68vh] max-w-4xl flex-col items-center justify-center py-16 text-center">
            <div className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-cyan/[0.055] blur-[130px]" />
            <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan/65">
              {t("heroEyebrow", { role: data.orientation_label || t("orientationFallback") })}
            </p>
            <h1 className={isChinese
              ? "max-w-[15em] text-[2.25rem] font-semibold leading-[1.3] tracking-[-0.04em] text-white [text-wrap:balance] sm:text-[3.6rem]"
              : "font-display max-w-4xl text-[2.3rem] font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-[3.8rem]"
            }>
              {primaryStep
                ? t("heroIdentity", { skill: primaryStep.skill_name })
                : t("heroIdentityComplete")}
            </h1>

            <div className="mt-10 w-full max-w-2xl rounded-3xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[0_30px_100px_-50px_rgba(27,229,238,0.45)] backdrop-blur-xl sm:p-8">
              <div className="flex items-end justify-between gap-4 text-left">
                <div>
                  <p className="text-xs font-medium text-slate-400">{t("termReady")}</p>
                  <p className="mt-1 font-mono text-5xl font-medium tracking-[-0.06em] text-white sm:text-6xl">
                    {currentCoverage}<span className="ml-1 text-xl text-cyan">%</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">{t("profileEvidenceCount", { count: data.assessed_required_count, total: data.required_skill_count })}</p>
                  {projectedCoverage > currentCoverage && (
                    <p className="mt-2 text-sm text-slate-300">
                      {t("heroProjected", { weeks: totalWeeks, coverage: projectedCoverage })}
                    </p>
                  )}
                </div>
              </div>
              <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
                {projectedCoverage > currentCoverage && (
                  <motion.div initial={{ width: 0 }} animate={{ width: `${projectedCoverage}%` }} transition={{ duration: 0.9, delay: 0.2 }} className="absolute inset-y-0 left-0 rounded-full bg-cyan/20" />
                )}
                <motion.div initial={{ width: 0 }} animate={{ width: `${currentCoverage}%` }} transition={{ duration: 0.9 }} className="absolute inset-y-0 left-0 z-10 rounded-full bg-cyan shadow-[0_0_18px_rgba(27,229,238,0.55)]" />
              </div>
              <p className="mt-4 text-left text-sm leading-relaxed text-slate-400">
                {t("heroProjection", { hours: weeklyHours, weeks: totalWeeks, current: currentCoverage, projected: projectedCoverage })}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="#roadmap" className="rounded-full bg-cyan px-7 py-3.5 text-sm font-bold text-[hsl(222_47%_6%)] transition-all hover:scale-[1.03] hover:shadow-[0_0_30px_rgba(27,229,238,0.55)] active:scale-95">
                {t("heroCta")}
              </a>
              {remainingEvidence > 0 && (
                <Link href={`/survey?session=${sessionId}&required_only=1`} className="rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm text-slate-300 transition hover:border-cyan/35 hover:text-white">
                  {t("completeRemaining", { count: remainingEvidence })}
                </Link>
              )}
            </div>
            <p className="mt-4 max-w-xl text-xs leading-relaxed text-slate-500">{t("heroBoundary")}</p>
          </section>

          {/* Zippi只负责解释，不再重复Hero的覆盖度。 */}
          {voice && (
            <div className="mx-auto max-w-4xl space-y-5">
                <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.5 }}
                  className="overflow-visible rounded-3xl border border-white/10 bg-[#121826]/60 backdrop-blur-xl">
                  {/* 顶部仪器状态条 */}
                  <div className="flex items-center justify-between rounded-t-3xl border-b border-white/5 bg-white/[0.02] px-5 py-2.5">
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
                  <div className="flex flex-col gap-6 p-7 md:flex-row md:gap-9">
                    <div className="flex shrink-0 flex-col items-center gap-3 md:w-32">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-cyan/20 blur-2xl" />
                        <img src="/icons/zippi/thinking.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }} className="relative z-10 h-20 w-20" style={{ imageRendering: "pixelated" }} alt="Zippi" />
                      </div>
                      <p className="text-xs font-medium text-cyan/80">{t("zippiAnalysis")}</p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-5">
                      {voiceSections ? (
                        <div className="space-y-4 text-base font-normal leading-[1.8] tracking-[0.005em] text-slate-200">
                          <p className="max-w-[54rem] text-slate-100/90">{voiceSections.summary}</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-cyan/10 bg-cyan/[0.035] p-4">
                              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan/70">{t("voicePrimaryGap")}</p>
                              <p>{voiceSections.primary_gap}</p>
                            </div>
                            <div className="rounded-2xl border border-gold/10 bg-gold/[0.035] p-4">
                              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-gold/75">{t("voiceNextAction")}</p>
                              <p>{voiceSections.next_action}</p>
                            </div>
                          </div>
                          <p className="border-t border-white/5 pt-4 text-xs leading-relaxed text-slate-500">
                            <span className="mr-2 font-mono uppercase tracking-wide text-slate-400">{t("voiceHonestNote")}</span>
                            {voiceSections.honest_note}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4 text-base font-normal leading-[1.8] tracking-[0.005em] text-slate-200">
                          {voice.split(/\n\s*\n/).map((para, i) => (<p key={i}>{para.trim()}</p>))}
                        </div>
                      )}
                      <div className="flex items-start gap-2 border-t border-white/5 pt-4">
                        <span className="text-lg leading-none text-gold">&ldquo;</span>
                        <p className="text-xs italic leading-relaxed text-slate-500">{t.rich("termBacking", { count: 759, u: (c) => <span className="text-slate-300 underline underline-offset-4">{c}</span> })}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
            </div>
          )}
          {/* ── Journey Spine：从工程到 AI 的唯一叙事过渡层（少讲·慢亮·往前走） ── */}
          <JourneySpine data={data} />
        </div>

        <PriorityGaps data={data} />

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
            <div id="roadmap" className="relative scroll-mt-24 space-y-5 pl-8">
              <span className="absolute left-[11px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-cyan via-gold to-transparent" />
              {data.next_steps.map((ns, i) => {
                const isDone = done.has(ns.skill_id);
                const isCurrent = !isDone && data.next_steps.slice(0, i).every((step) => done.has(step.skill_id));
                return (
                <Reveal key={ns.skill_id} i={i}>
                  <div id={`step-${ns.skill_id}`} className="relative scroll-mt-24">
                    <span
                      className={
                        "absolute -left-8 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-colors " +
                        (isDone
                          ? "border-cyan bg-cyan text-background shadow-[0_0_12px_hsl(183_86%_52%/0.6)]"
                          : isCurrent
                            ? "border-gold/70 bg-card text-gold shadow-[0_0_12px_rgba(255,184,0,0.35)]"
                            : "border-white/15 bg-card text-slate-500")
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
                    <Card className={"transition-colors " + (isDone ? "border-emerald-400/30 bg-emerald-400/[0.025]" : isCurrent ? "border-gold/35 bg-gold/[0.025]" : "border-white/[0.07] opacity-75")}>
                      <CardContent className="space-y-4 pt-6">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                              {isDone ? t("taskComplete") : isCurrent ? t("taskCurrent") : t("step", { rank: ns.rank })}
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
                            <ul className="space-y-2 text-sm">
                              {ns.acceptance_criteria.map((c, k) => <li key={k} className="flex gap-2"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 text-[9px] text-cyan">{isDone ? "✓" : ""}</span><span>{c}</span></li>)}
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
          <button onClick={downloadDna} disabled={genShare} className="rounded-full border border-white/12 bg-white/[0.03] px-6 py-2.5 text-sm text-foreground transition-all hover:border-cyan/40 hover:bg-white/[0.06] disabled:opacity-60">
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

/* Zeno Skill Tree：由真实画像和当前路线动态点亮，不再展示固定Prompt剧本。 */
function JourneySpine({ data }: { data: ResultResponse }) {
  const t = useTranslations("result");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: spineRef, offset: ["start center", "end center"] });
  const lineScale = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });
  const skillNames = new Map([
    ...data.profile.map((skill) => [skill.skill_id, skill.skill_name] as const),
    ...data.gaps.map((skill) => [skill.skill_id, skill.skill_name] as const),
  ]);
  const nodes = [
    ...data.strengths.slice(0, 3).map((skill) => ({
      id: skill.skill_id,
      name: skill.skill_name,
      detail: skill.reason,
      level: skill.level,
      evidence: skill.reason,
      usage: skill.ai_usage,
      boundaries: skill.non_ai_boundaries,
      unblocks: [] as string[],
      state: "mastered" as const,
    })),
    ...data.next_steps.slice(0, 3).map((step, index) => ({
      id: step.skill_id,
      name: step.skill_name,
      detail: index === 0 ? step.why : step.action_title,
      level: step.current_level,
      targetLevel: step.target_level,
      evidence: step.why,
      usage: [] as string[],
      boundaries: [] as string[],
      unblocks: step.unblocks.map((skillId) => skillNames.get(skillId) ?? skillId),
      state: index === 0 ? "now" as const : "later" as const,
    })),
  ];
  return (
    <section ref={spineRef} className="mx-auto max-w-3xl py-6">
      <div className="mb-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan/60">Zeno Skill Tree</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">{t("skillTreeTitle")}</h2>
        <p className="mt-2 text-sm text-slate-400">{t("skillTreeSubtitle")}</p>
      </div>
      <div className="relative pl-12">
      <div className="absolute bottom-8 left-[17px] top-8 w-[2px] overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div style={{ scaleY: lineScale, originY: 0 }} className="absolute inset-0 bg-gradient-to-b from-cyan via-magenta to-gold shadow-[0_0_10px_#1BE5EE]" />
      </div>
      <div className="space-y-3">
        {nodes.map((node, index) => {
          const mastered = node.state === "mastered";
          const current = node.state === "now";
          return (
            <motion.div key={node.id} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.07 }} className="group relative">
              <span className={"absolute -left-[43px] top-6 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0A0D14] " + (mastered ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.65)]" : current ? "bg-gold shadow-[0_0_16px_rgba(255,184,0,0.65)]" : "bg-slate-700")}>{mastered && <span className="text-[10px] font-bold text-[#07110d]">✓</span>}</span>
              <button type="button" aria-expanded={expandedId === node.id} onClick={() => setExpandedId((value) => value === node.id ? null : node.id)} className={"w-full rounded-2xl border px-5 py-4 text-left transition-all " + (mastered ? "border-emerald-400/20 bg-emerald-400/[0.035] hover:border-emerald-400/40" : current ? "border-gold/45 bg-gold/[0.055] shadow-[0_12px_40px_-24px_rgba(255,184,0,0.5)] hover:border-gold/70" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15") }>
                <div className="flex items-center justify-between gap-4">
                  <h3 className={"text-base font-medium " + (mastered ? "text-emerald-200" : current ? "text-gold" : "text-slate-300")}>{node.name}</h3>
                  <span className="flex items-center gap-2"><span className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">{t(mastered ? "skillMastered" : current ? "skillCurrent" : "skillLater")}</span><span className={"text-xs text-slate-500 transition-transform " + (expandedId === node.id ? "rotate-180" : "")}>⌄</span></span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{node.detail}</p>
                <AnimatePresence initial={false}>
                  {expandedId === node.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-4 grid gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-2">
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">{t(mastered ? "skillWhyJudged" : "skillWhyPriority")}</p>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{node.evidence}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">{mastered ? t("skillHowTransfers") : t("skillWhyNow")}</p>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                            {mastered
                              ? node.usage[0] || t("skillTransferFallback")
                              : node.unblocks.length > 0
                                ? t("skillUnlocks", { skills: node.unblocks.join("、") })
                                : t("skillCurrentTarget", { current: node.level, target: node.targetLevel ?? node.level })}
                          </p>
                        </div>
                        {mastered && node.boundaries[0] && <p className="sm:col-span-2 text-[11px] leading-relaxed text-slate-500"><span className="mr-1 text-slate-400">{t("boundaryLabel")}：</span>{node.boundaries[0]}</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </motion.div>
          );
        })}
      </div>
      </div>
    </section>
  );
}

function PriorityGaps({ data }: { data: ResultResponse }) {
  const t = useTranslations("result");
  const [showAll, setShowAll] = useState(false);
  const skillNames = new Map([
    ...data.profile.map((skill) => [skill.skill_id, skill.skill_name] as const),
    ...data.gaps.map((skill) => [skill.skill_id, skill.skill_name] as const),
  ]);
  const ordered = data.next_steps.slice(0, 3).map((step) => ({
    step,
    gap: data.gaps.find((item) => item.skill_id === step.skill_id),
  }));
  const remaining = data.gaps.filter((gap) => gap.gap > 0 && !ordered.some(({ step }) => step.skill_id === gap.skill_id));
  if (ordered.length === 0) return null;
  return (
    <Section index={2} title={t("priorityGapsTitle", { count: ordered.length })} subtitle={t("priorityGapsSubtitle")}>
      <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.018]">
        {ordered.map(({ step, gap }, index) => (
          <div key={step.skill_id} className="grid gap-4 border-b border-white/[0.06] p-5 last:border-b-0 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
            <span className={"flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs " + (index === 0 ? "border-gold/50 bg-gold/10 text-gold" : "border-white/10 bg-white/[0.03] text-slate-400")}>{index + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-slate-100">{step.skill_name}</h3>
                <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] text-slate-500">L{step.current_level}→L{step.target_level}</span>
                {gap && <span className="rounded-full border border-magenta/20 bg-magenta/[0.06] px-2 py-0.5 text-[9px] text-magenta/80">{t(gap.type === "required" ? "required" : "bonus")}</span>}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{step.why}</p>
              {step.unblocks.length > 0 && <p className="mt-2 text-xs text-slate-500">{t("skillUnlocks", { skills: step.unblocks.map((skillId) => skillNames.get(skillId) ?? skillId).join("、") })}</p>}
            </div>
            <a href={`#step-${step.skill_id}`} className="justify-self-start rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:border-gold/40 hover:text-gold sm:justify-self-end">{t("viewTask")}→</a>
          </div>
        ))}
      </div>
      {remaining.length > 0 && (
        <div className="text-center">
          <button type="button" onClick={() => setShowAll((value) => !value)} className="text-xs text-slate-500 transition hover:text-cyan">
            {showAll ? t("gapsShowLess") : t("otherGapsCount", { count: remaining.length })}
          </button>
          <AnimatePresence initial={false}>
            {showAll && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="mt-4 flex flex-wrap justify-center gap-2">{remaining.map((gap) => <span key={gap.skill_id} className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-400">{gap.skill_name}<span className="ml-1.5 font-mono text-[9px] text-slate-600">L{gap.current_level}→L{gap.target_level}</span></span>)}</div></motion.div>}
          </AnimatePresence>
        </div>
      )}
    </Section>
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
                    {r.ai_curated && <span className="rounded border border-purple-400/20 bg-purple-400/10 px-1.5 py-0.5 text-purple-200/80">{t("aiCurated")}</span>}
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
