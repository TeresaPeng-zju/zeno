"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import type { Edge, Node } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CareerGraph, type ZenoNodeData } from "@/components/zeno/career-graph";
import { CircularProgress } from "@/components/zeno/circular-progress";
import { RoleJourney } from "@/components/zeno/role-journey";
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
  const sessionId = params.get("session");
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
        {/* header */}
        <div className="space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("generatedFrom", { count: data.profile.length })}
            </p>
            {data.orientation && data.orientation !== "base" && data.orientation_label && (
              <span className="hairline mt-1 inline-flex items-center gap-1.5 rounded-full bg-cyan/10 px-3 py-1 text-xs text-cyan">
                {t("orientationTag", { label: data.orientation_label })}
              </span>
            )}
          </div>
          <RoleJourney current={tr("frontend")} target={tr("aiEngineer")} progress={data.readiness / 100} />
        </div>

        {/* readiness + graph */}
        <section id="gap" className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col items-center justify-center gap-4 py-8">
            <CircularProgress value={data.readiness} label={t("careerReadiness")} />
            <div className="flex gap-5 text-center text-xs text-muted-foreground">
              <Stat n={data.strengths.length} label={t("statStrengths")} tone="text-cyan" />
              <Stat n={data.gaps.length} label={t("statGaps")} tone="text-magenta" />
              <Stat n={data.next_steps.length} label={t("statNextSteps")} tone="text-gold" />
            </div>
          </Card>
          <div>
            <CareerGraph nodes={graph.nodes} edges={graph.edges} height={420} />
          </div>
        </section>

        {/* Section 1: strengths */}
        <Section index={1} title={t("section1Title")} subtitle={t("section1Subtitle")}>
          {data.strengths.length === 0 ? (
            <EmptyHint text={t("section1Empty")} />
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
        <Section index={2} title={t("section2Title")} subtitle={t("section2Subtitle")}>
          {data.gaps.length === 0 ? (
            <EmptyHint text={t("section2Empty")} />
          ) : (
            <Card>
              <CardContent className="space-y-2.5 pt-6">
                {data.gaps.map((g) => (
                  <div key={g.skill_id} className="flex items-center justify-between gap-3 border-b border-border/40 pb-2.5 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-medium " + (g.type === "required" ? "bg-magenta/15 text-magenta" : "bg-gold/15 text-gold")}>
                        {g.type === "required" ? t("required") : t("bonus")}
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

        <div className="flex gap-3">
          <Link href="/skills"><Button variant="outline">{t("reassess")}</Button></Link>
          <Link href="/"><Button variant="ghost">{t("backHome")}</Button></Link>
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
