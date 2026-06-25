"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Centered } from "@/components/site/centered";
import {
  api,
  type ExperienceCapsulesResponse,
  type CapsuleOut,
  type SkillCatalogResponse,
} from "@/lib/api";

type CapsuleSelections = Record<string, string>;
type SkillSelections = Record<string, string>;

function levelToAnswerValue(level: number): string {
  if (level >= 4) return "expert";
  if (level >= 3) return "shipped";
  if (level >= 2) return "demo";
  if (level >= 1) return "tutorial";
  return "none";
}

// Flatten all capsules from categories + AI exploration into a single ordered list
// Each item carries its category label for section headers
type FlatCapsule = CapsuleOut & { catId: string; catLabel: string; catHint: string; isAi?: boolean };

function flattenCapsules(data: ExperienceCapsulesResponse): FlatCapsule[] {
  const result: FlatCapsule[] = [];
  for (const cat of data.categories) {
    for (const cap of cat.capsules) {
      result.push({ ...cap, catId: cat.id, catLabel: cat.label, catHint: cat.hint });
    }
  }
  if (data.ai_exploration) {
    for (const cap of data.ai_exploration.capsules) {
      result.push({
        ...cap,
        catId: "ai_exploration",
        catLabel: data.ai_exploration.label,
        catHint: data.ai_exploration.hint,
        isAi: true,
      });
    }
  }
  return result;
}

function SkillsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const [sessionId, setSessionId] = useState<string | null>(params.get("session"));
  const [catalog, setCatalog] = useState<SkillCatalogResponse | null>(null);
  const [capsuleData, setCapsuleData] = useState<ExperienceCapsulesResponse | null>(null);
  const [capsuleSelections, setCapsuleSelections] = useState<CapsuleSelections>({});
  const [visibleCount, setVisibleCount] = useState(1);
  const [showAiSection, setShowAiSection] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null); // last acknowledged capsule id
  const [step, setStep] = useState<"capsules" | "confirm">("capsules");
  const [skillSelections, setSkillSelections] = useState<SkillSelections>({});
  const [probeAnswers, setProbeAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentRole = params.get("current_role") || undefined;
  const targetRole = params.get("target_role") || undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let sid = sessionId;
        if (!sid) {
          const created = await api.createSession("base", currentRole);
          sid = created.session_id;
          if (!cancelled) setSessionId(sid);
        }
        const [cat, capData] = await Promise.all([
          api.skills(currentRole, targetRole),
          currentRole ? api.experienceCapsules(currentRole) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCatalog(cat);
        if (capData && capData.categories.length > 0) {
          setCapsuleData(capData);
        } else {
          setStep("confirm");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : tc("backendDown"));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flatCapsules = useMemo(() => {
    if (!capsuleData) return [];
    const main = flattenCapsules({ ...capsuleData, ai_exploration: null });
    return main;
  }, [capsuleData]);

  const aiCapsules = useMemo(() => {
    if (!capsuleData?.ai_exploration) return [];
    return capsuleData.ai_exploration.capsules.map((cap) => ({
      ...cap,
      catId: "ai_exploration",
      catLabel: capsuleData.ai_exploration!.label,
      catHint: capsuleData.ai_exploration!.hint,
      isAi: true,
    }));
  }, [capsuleData]);

  // Build inferred capabilities
  const inferred = useMemo(() => {
    if (!capsuleData) return [];
    const tierMap = Object.fromEntries(capsuleData.depth_tiers.map((t) => [t.id, t.level_offset]));
    const allCaps = [...flatCapsules, ...aiCapsules];
    const acc: Record<string, { capability: string; level: number; confidence: number; sources: string[] }> = {};
    for (const cap of allCaps) {
      const tierId = capsuleSelections[cap.id];
      if (!tierId || tierId === "none") continue;
      const offset = tierMap[tierId] ?? 0;
      if (offset < 0) continue;
      for (const m of cap.maps_to) {
        const level = Math.min(4, m.base_level + offset);
        const existing = acc[m.skill_id];
        if (!existing || level > existing.level) {
          acc[m.skill_id] = { capability: cap.capability, level, confidence: m.confidence, sources: [cap.text] };
        } else if (level === existing.level) {
          existing.sources.push(cap.text);
        }
      }
    }
    return Object.entries(acc).map(([skillId, v]) => ({ skillId, ...v }));
  }, [capsuleData, capsuleSelections, flatCapsules, aiCapsules]);

  function selectDepth(capsuleId: string, tierId: string) {
    const isFirstAnswer = !capsuleSelections[capsuleId];

    setCapsuleSelections((prev) => {
      if (prev[capsuleId] === tierId) {
        // Deselect — don't change visible count
        const n = { ...prev };
        delete n[capsuleId];
        return n;
      }
      return { ...prev, [capsuleId]: tierId };
    });

    // Only reveal next capsule on FIRST answer to this capsule
    if (isFirstAnswer) {
      setAcknowledged(capsuleId);
      setTimeout(() => {
        setAcknowledged(null);
        setVisibleCount((prev) => Math.min(prev + 1, flatCapsules.length));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
      }, 500);
    }
  }

  function proceedToConfirm() {
    const prefilled: SkillSelections = {};
    for (const inf of inferred) {
      prefilled[inf.skillId] = levelToAnswerValue(inf.level);
    }
    setSkillSelections(prefilled);
    setStep("confirm");
  }

  function adjustLevel(skillId: string, delta: number) {
    setSkillSelections((prev) => {
      const levels = ["none", "tutorial", "demo", "shipped", "expert"];
      const idx = levels.indexOf(prev[skillId] ?? "none");
      const newIdx = Math.max(0, Math.min(4, idx + delta));
      return { ...prev, [skillId]: levels[newIdx] };
    });
  }

  async function generate() {
    if (!sessionId) return;
    const final = { ...skillSelections };
    for (const [skillId, level] of Object.entries(probeAnswers)) {
      final[skillId] = levelToAnswerValue(level);
    }
    if (Object.keys(final).length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const [skillId, value] of Object.entries(final)) {
        await api.submitAnswer(sessionId, skillId, value);
      }
      router.push(`/result?session=${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("submitFailed"));
      setSubmitting(false);
    }
  }

  if (error && !catalog) return <Centered text={error} tone="error" />;
  if (!catalog) return <Centered text={t("preparing")} />;

  // ── Step 1: Conversational capsule flow ──
  if (step === "capsules" && capsuleData && flatCapsules.length > 0) {
    const visible = flatCapsules.slice(0, visibleCount);
    const answeredCount = Object.keys(capsuleSelections).length;
    const allMainDone = visibleCount >= flatCapsules.length && answeredCount >= flatCapsules.length;
    let lastCatId = "";

    return (
      <main className="container relative max-w-2xl py-14">
        <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
        <div className="relative space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("capsuleTitle")}</h1>
          <p className="mx-auto max-w-lg text-muted-foreground">{t("capsuleHint")}</p>
        </div>

        <div className="relative mt-10 space-y-5">
          <AnimatePresence mode="popLayout">
            {visible.map((cap, i) => {
              const isNew = i === visible.length - 1 && i > 0;
              const showHeader = cap.catId !== lastCatId;
              lastCatId = cap.catId;
              const selected = capsuleSelections[cap.id];
              const isAcked = acknowledged === cap.id;

              return (
                <motion.div
                  key={cap.id}
                  initial={isNew ? { opacity: 0, y: 20, filter: "blur(8px)" } : false}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* Category header */}
                  {showHeader && (
                    <div className="mb-3 mt-2">
                      <h2 className="text-base font-semibold text-foreground">{cap.catLabel}</h2>
                      <p className="text-xs text-muted-foreground">{cap.catHint}</p>
                    </div>
                  )}

                  {/* Capsule card */}
                  <div className={
                    "rounded-xl border px-4 py-4 transition-all duration-300 " +
                    (selected
                      ? selected === "none"
                        ? "border-border/40 bg-card/30"
                        : "border-cyan/40 bg-cyan/[0.04]"
                      : "border-border/60 bg-card/40")
                  }>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-foreground/90 leading-relaxed">{cap.text}</p>
                      {/* Info button */}
                      <button
                        type="button"
                        onClick={() => setInfoOpen(infoOpen === cap.id ? null : cap.id)}
                        className="shrink-0 mt-0.5 h-5 w-5 rounded-full border border-border/50 text-[10px] text-muted-foreground transition-colors hover:border-cyan/40 hover:text-cyan flex items-center justify-center"
                        aria-label="Why this question?"
                      >
                        i
                      </button>
                    </div>

                    {/* Info tooltip */}
                    <AnimatePresence>
                      {infoOpen === cap.id && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <p className="mt-2 rounded-lg bg-cyan/[0.06] px-3 py-2 text-xs text-muted-foreground">
                            {cap.capability}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Depth tier buttons */}
                    <div className="mt-3 flex gap-1.5">
                      {capsuleData.depth_tiers.map((tier) => {
                        const isNone = tier.id === "none";
                        const isSel = selected === tier.id;
                        return (
                          <button
                            key={tier.id}
                            type="button"
                            onClick={() => selectDepth(cap.id, tier.id)}
                            className={
                              "rounded-lg border px-3 py-1.5 text-xs transition-all " +
                              (isSel
                                ? isNone
                                  ? "border-muted-foreground/40 bg-muted/30 text-muted-foreground font-medium"
                                  : "border-cyan/60 bg-cyan/15 text-cyan font-medium"
                                : "border-border/50 text-muted-foreground hover:border-cyan/30 hover:text-foreground")
                            }
                          >
                            {tier.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Acknowledgment */}
                    {isAcked && selected && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-2 text-xs text-cyan"
                      >
                        ✓ 已了解
                      </motion.p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* AI exploration opt-in */}
          {allMainDone && capsuleData.ai_exploration && !showAiSection && (
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              type="button"
              onClick={() => setShowAiSection(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border/40 bg-card/30 px-4 py-3 text-left text-sm text-muted-foreground transition-all hover:border-cyan/30 hover:text-foreground"
            >
              <span className="text-lg">{capsuleData.ai_exploration.icon}</span>
              <span>{capsuleData.ai_exploration.hint}</span>
              <span className="ml-auto">+</span>
            </motion.button>
          )}

          {/* AI exploration capsules */}
          {showAiSection && aiCapsules.map((cap, i) => {
            const selected = capsuleSelections[cap.id];
            return (
              <motion.div
                key={cap.id}
                initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: i * 0.12, duration: 0.4 }}
              >
                <div className={"rounded-xl border px-4 py-4 transition-all " + (selected && selected !== "none" ? "border-cyan/40 bg-cyan/[0.04]" : "border-border/60 bg-card/40")}>
                  <p className="text-sm text-foreground/90">{cap.text}</p>
                  <div className="mt-3 flex gap-1.5">
                    {capsuleData.depth_tiers.map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setCapsuleSelections((p) => p[cap.id] === tier.id ? (() => { const n = { ...p }; delete n[cap.id]; return n; })() : { ...p, [cap.id]: tier.id })}
                        className={"rounded-lg border px-3 py-1.5 text-xs transition-all " + (selected === tier.id ? (tier.id === "none" ? "border-muted-foreground/40 bg-muted/30 text-muted-foreground font-medium" : "border-cyan/60 bg-cyan/15 text-cyan font-medium") : "border-border/50 text-muted-foreground hover:border-cyan/30")}
                      >
                        {tier.label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })}

          <div ref={bottomRef} />
        </div>

        {/* Sticky action bar */}
        <div className="sticky bottom-5 z-30 mt-12">
          <div className="hairline mx-auto flex max-w-xl items-center justify-between gap-4 rounded-2xl bg-card/85 px-5 py-3 backdrop-blur-xl">
            <p className="text-sm text-muted-foreground">{t("capsuleSelected", { count: answeredCount })}</p>
            <Button onClick={proceedToConfirm} disabled={answeredCount === 0}>{t("capsuleNext")}</Button>
          </div>
        </div>
      </main>
    );
  }

  // ── Step 2: Transferable advantages ──
  if (capsuleData && step === "confirm") {
    const probes = capsuleData.confirm_probes.filter((p) => !inferred.some((i) => i.skillId === p.skill_id));
    return (
      <main className="container relative max-w-3xl py-14">
        <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
        <div className="relative space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("confirmTitle")}</h1>
          <p className="mx-auto max-w-xl text-muted-foreground">{t("confirmHint")}</p>
        </div>

        <button type="button" onClick={() => setStep("capsules")} className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors">{t("confirmBack")}</button>

        {inferred.length > 0 && (
          <section className="mt-6 space-y-3">
            <h2 className="text-base font-semibold">{t("transferTitle")}</h2>
            {inferred.map((inf, i) => (
              <motion.div key={inf.skillId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="rounded-xl border border-cyan/30 bg-cyan/[0.04] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">{inf.capability}</span>
                    <span className="ml-2 text-xs text-cyan">{inf.level >= 3 ? "很强" : inf.level >= 2 ? "可迁移" : "有基础"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => adjustLevel(inf.skillId, -1)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors">低了</button>
                    <span className="text-xs text-cyan font-medium w-6 text-center">L{inf.level}</span>
                    <button onClick={() => adjustLevel(inf.skillId, 1)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors">高了</button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">← {inf.sources.slice(0, 2).join("、")}</p>
              </motion.div>
            ))}
          </section>
        )}

        {probes.length > 0 && (
          <section className="mt-8 space-y-3">
            <h2 className="text-base font-semibold">{t("assessTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("assessHint")}</p>
            {probes.map((probe) => (
              <div key={probe.skill_id} className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
                <span className="text-sm font-medium text-foreground">{probe.name}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{probe.explain}</p>
                <div className="mt-2 flex gap-1.5">
                  {probe.options.map((opt, oi) => (
                    <button key={oi} onClick={() => setProbeAnswers((p) => ({ ...p, [probe.skill_id]: probe.option_levels[oi] }))} className={
                      "rounded-lg border px-3 py-1.5 text-xs transition-all " +
                      (probeAnswers[probe.skill_id] === probe.option_levels[oi] ? "border-cyan/60 bg-cyan/15 text-cyan font-medium" : "border-border/50 text-muted-foreground hover:border-cyan/30")
                    }>{opt}</button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <div className="sticky bottom-5 z-30 mt-12">
          <div className="hairline mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-2xl bg-card/85 px-5 py-3 backdrop-blur-xl">
            <p className="text-sm text-muted-foreground">
              {t.rich("selectedCount", { count: Object.keys(skillSelections).length + Object.keys(probeAnswers).length, c: (chunks) => <span className="font-semibold text-foreground">{chunks}</span> })}
            </p>
            <Button onClick={generate} disabled={submitting || (Object.keys(skillSelections).length + Object.keys(probeAnswers).length) === 0}>
              {submitting ? t("generating") : t("generatePath")}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // ── Fallback ──
  return (
    <main className="container relative max-w-4xl py-14">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="relative mt-10 space-y-8">
        {catalog.groups.map((group) => (
          <section key={group.category}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-base font-semibold">{group.label}</h2>
              <span className="text-xs text-muted-foreground">{group.hint}</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {group.skills.map((skill) => (
                <button key={skill.skill_id} onClick={() => setSkillSelections((s) => ({ ...s, [skill.skill_id]: s[skill.skill_id] ? "" : "demo" }))} className={
                  "rounded-full border px-4 py-2 text-sm transition-all " +
                  (skillSelections[skill.skill_id] ? "border-cyan/70 bg-cyan/10 text-cyan" : "border-border bg-surface/60 text-foreground hover:border-primary/50")
                }><span className="font-medium">{skill.name}</span></button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="sticky bottom-5 z-30 mt-12">
        <div className="hairline mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-2xl bg-card/85 px-5 py-3 backdrop-blur-xl">
          <p className="text-sm text-muted-foreground">{t.rich("selectedCount", { count: Object.keys(skillSelections).filter((k) => skillSelections[k]).length, c: (chunks) => <span className="font-semibold text-foreground">{chunks}</span> })}</p>
          <Button onClick={generate} disabled={submitting}>{submitting ? t("generating") : t("generatePath")}</Button>
        </div>
      </div>
    </main>
  );
}

export default function SkillsPage() {
  const tc = useTranslations("common");
  return (<Suspense fallback={<Centered text={tc("loading")} />}><SkillsInner /></Suspense>);
}
