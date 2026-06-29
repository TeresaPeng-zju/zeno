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

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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
  const [fullCatalog, setFullCatalog] = useState<SkillCatalogResponse | null>(null);
  const [capsuleData, setCapsuleData] = useState<ExperienceCapsulesResponse | null>(null);
  const [capsuleSelections, setCapsuleSelections] = useState<CapsuleSelections>({});
  const [visibleCount, setVisibleCount] = useState(1);
  const [showAiSection, setShowAiSection] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null); // last acknowledged capsule id
  const [step, setStep] = useState<"capsules" | "confirm">("capsules");
  const [skillSelections, setSkillSelections] = useState<SkillSelections>({});
  const [adjustments, setAdjustments] = useState<Record<string, "underestimated" | "accurate" | "overestimated">>({});
  const [probeAnswers, setProbeAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);
  const [zippiMsg, setZippiMsg] = useState<string>("");
  // Zippi 校准探针：{触发的胶囊, 对应技能, 基础水平, 已选档, 类型}
  const [probe, setProbe] = useState<{ capId: string; skillId: string; baseLevel: number; tierId: string; kind: "intro" | "calibrate" } | null>(null);
  const [probeText, setProbeText] = useState("");
  const [probeReply, setProbeReply] = useState<{ msg: string; suggestTier?: string } | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeCount, setProbeCount] = useState(0);
  const [probedCaps, setProbedCaps] = useState<Set<string>>(new Set());
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
        const [cat, fullCat, capData] = await Promise.all([
          api.skills(currentRole, targetRole),
          api.skills(),   // full unfiltered — for skill name lookup
          currentRole ? api.experienceCapsules(currentRole) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCatalog(cat);
        setFullCatalog(fullCat);
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

  // 本地存档案：记住 session_id，下次能回来看自己的诊断（无需登录）
  useEffect(() => {
    if (sessionId) {
      try { localStorage.setItem("zeno:lastSession", sessionId); } catch { /* ignore */ }
    }
  }, [sessionId]);

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
        if (m.confidence < 0.4) continue;   // low-confidence mappings don't surface as inferred skills
        const level = Math.min(4, m.base_level + offset);
        const existing = acc[m.skill_id];
        if (!existing || level > existing.level) {
          acc[m.skill_id] = { capability: cap.capability, level, confidence: m.confidence, sources: [cap.text] };
        } else if (level === existing.level) {
          existing.sources.push(cap.text);
        }
      }
    }
    // Build skill_id → skill_name lookup from full unfiltered catalog
    const skillNameMap: Record<string, string> = {};
    const nameSource = fullCatalog ?? catalog;
    if (nameSource) {
      for (const group of nameSource.groups) {
        for (const skill of group.skills) {
          skillNameMap[skill.skill_id] = skill.name;
        }
      }
    }
    return Object.entries(acc).map(([skillId, v]) => ({
      skillId,
      skillName: skillNameMap[skillId] ?? skillId,
      ...v,
    }));
  }, [capsuleData, capsuleSelections, flatCapsules, aiCapsules, catalog]);

  // 实时就绪度估算：随每次点选跳动的"距离条"（前端估值，结果页给精确值）
  const readiness = useMemo(() => {
    const target = catalog ? catalog.groups.reduce((n, g) => n + g.skills.length, 0) : 0;
    if (!target) return 0;
    let covered = 0;
    for (const inf of inferred) covered += Math.min(inf.level, 3) / 3;
    return Math.min(92, Math.round((covered / target) * 130));
  }, [inferred, catalog]);

  function maybeProbe(capsuleId: string, tierId: string) {
    // 三层触发：① 首个胶囊必触发(建立关系) ② 高价值×极端档智能校准 ③ 全程限 3 次
    if (!capsuleData || tierId === "none") return;
    if (probedCaps.has(capsuleId) || probeCount >= 3) return;
    const cap = [...flatCapsules, ...aiCapsules].find((c) => c.id === capsuleId);
    const mapped = cap?.maps_to?.find((m) => m.confidence >= 0.5);
    if (!mapped) return;
    const tier = capsuleData.depth_tiers.find((t) => t.id === tierId);
    const offsets = capsuleData.depth_tiers.map((t) => t.level_offset);
    const isExtreme = tier && (tier.level_offset === Math.max(...offsets) || tier.level_offset === Math.min(...offsets.filter((o) => o >= 0)));
    const kind: "intro" | "calibrate" | null = probeCount === 0 ? "intro" : isExtreme ? "calibrate" : null;
    if (!kind) return;
    setProbe({ capId: capsuleId, skillId: mapped.skill_id, baseLevel: mapped.base_level, tierId, kind });
    setProbeText("");
    setProbeReply(null);
    setProbeCount((c) => c + 1);
    setProbedCaps((p) => new Set(p).add(capsuleId));
  }

  function selectDepth(capsuleId: string, tierId: string, fromProbe = false) {
    const isFirstAnswer = !capsuleSelections[capsuleId];
    if (!fromProbe) maybeProbe(capsuleId, tierId);

    // zippi 的实时反应（按这一档的"含金量"说话）
    const off = capsuleData?.depth_tiers.find((t) => t.id === tierId)?.level_offset ?? 0;
    setZippiMsg(
      off < 0 ? "没关系，跳过这个，我们看下一个～"
        : off === 0 ? "了解过也算数，先记下。"
        : off >= 2 ? "哇，这种经历含金量很高！又近了一步。"
        : "不错，这块你已经有手感了。",
    );

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

  async function sendProbe() {
    if (!probe || !sessionId || probeText.trim().length < 3 || !capsuleData) return;
    setProbeBusy(true);
    try {
      const r = await fetch(`${API}/api/sessions/${sessionId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: probeText }),
      });
      const d = await r.json();
      const hit = (d.skills || []).find((s: { skill_id: string; level: number }) => s.skill_id === probe.skillId);
      const tiers = capsuleData.depth_tiers;
      const curTier = tiers.find((t) => t.id === probe.tierId);
      if (!hit || !curTier) {
        setProbeReply({ msg: "嗯，记下了——你保留现在的选择就好，后面我会结合这段经历帮你校准。" });
      } else {
        const targetOff = hit.level - probe.baseLevel;
        const best = tiers.reduce((a, b) => (Math.abs(b.level_offset - targetOff) < Math.abs(a.level_offset - targetOff) ? b : a));
        if (best.level_offset > curTier.level_offset) {
          setProbeReply({ msg: `听起来你这块比你选的更强——更接近「${best.label}」。要帮你调上去吗？`, suggestTier: best.id });
        } else if (best.level_offset < curTier.level_offset) {
          setProbeReply({ msg: `听起来可能还没完全到那个程度，更像「${best.label}」。要调一下吗？`, suggestTier: best.id });
        } else {
          setProbeReply({ msg: `嗯，你选得挺准——这块确实是「${curTier.label}」。` });
        }
      }
    } catch {
      setProbeReply({ msg: "没连上，跳过这步就好。" });
    } finally {
      setProbeBusy(false);
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

        {/* 测距条 + zippi 向导：随每次点选实时跳动（top-20 让开 h-16 顶部导航，z-40 < 导航 z-50） */}
        <div className="sticky top-20 z-40 mx-auto mb-8 max-w-xl">
          <div className="hairline flex items-center gap-3 rounded-2xl bg-card/85 px-4 py-3 backdrop-blur-xl">
            <img
              src="/icons/zippi.png"
              alt="zippi"
              className="h-10 w-10 shrink-0"
              style={{ imageRendering: "pixelated" }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">你离 AI 应用工程师还有多远</span>
                <span className="text-sm font-semibold text-cyan">{readiness}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-cyan transition-all duration-500 ease-out"
                  style={{ width: `${readiness}%` }}
                />
              </div>
              <p className="mt-1.5 truncate text-xs text-cyan/80">
                {zippiMsg || "选一个你做过的，每点一下我们就近一步。"}
              </p>
            </div>
          </div>
        </div>

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
                    {isAcked && selected && !(probe?.capId === cap.id) && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-2 text-xs text-cyan"
                      >
                        ✓ {t("capsuleAcked")}
                      </motion.p>
                    )}

                    {/* Zippi 校准探针（建立关系 / 智能校准） */}
                    {probe?.capId === cap.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-3 overflow-hidden rounded-xl border border-cyan/30 bg-cyan/[0.05] p-3"
                      >
                        <div className="flex items-start gap-2">
                          <img
                            src={`/icons/zippi/${probe.kind === "intro" ? "curious" : "thinking"}.png`}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }}
                            className="h-7 w-7 shrink-0"
                            style={{ imageRendering: "pixelated" }}
                            alt=""
                          />
                          <div className="min-w-0 flex-1">
                            {!probeReply ? (
                              <>
                                <p className="text-xs leading-relaxed text-cyan/90">
                                  {probe.kind === "intro"
                                    ? `我看到你选了「${capsuleData.depth_tiers.find((t) => t.id === probe.tierId)?.label}」。讲一句你做过的真实场景吧——后面我会根据你的经历，帮你校准类似的能力。`
                                    : "不确定选得准不准？给我讲一句你在这块做过的，我帮你定位。"}
                                </p>
                                <div className="mt-2 flex gap-2">
                                  <input
                                    value={probeText}
                                    onChange={(e) => setProbeText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") sendProbe(); }}
                                    placeholder="例：在腾讯做过 Canvas 日历，处理拖拽和大规模渲染…"
                                    className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-cyan/50"
                                  />
                                  <button onClick={sendProbe} disabled={probeBusy || probeText.trim().length < 3} className="shrink-0 rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-[hsl(222_47%_6%)] disabled:opacity-40">
                                    {probeBusy ? "…" : "发送"}
                                  </button>
                                  <button onClick={() => setProbe(null)} className="shrink-0 rounded-lg border border-border/50 px-2 py-1.5 text-xs text-muted-foreground">忽略</button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-xs leading-relaxed text-cyan/90">{probeReply.msg}</p>
                                <div className="mt-2 flex gap-2">
                                  {probeReply.suggestTier && (
                                    <button
                                      onClick={() => { selectDepth(probe.capId, probeReply.suggestTier!, true); setProbe(null); }}
                                      className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-[hsl(222_47%_6%)]"
                                    >
                                      好，帮我调
                                    </button>
                                  )}
                                  <button onClick={() => setProbe(null)} className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
                                    {probeReply.suggestTier ? "不用，保持" : "知道了"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
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
            {inferred.map((inf, i) => {
              const adj = adjustments[inf.skillId];
              // 叠加用户修正到 level
              const displayLevel = adj === "underestimated" ? Math.min(4, inf.level + 1)
                : adj === "overestimated" ? Math.max(0, inf.level - 1)
                : inf.level;
              const tag = displayLevel >= 3 ? t("inferStrong") : displayLevel >= 2 ? t("inferTransferable") : t("inferBasic");
              const tagColor = displayLevel >= 3 ? "text-cyan border-cyan/40 bg-cyan/10"
                : displayLevel >= 2 ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
                : "text-amber-400 border-amber-400/40 bg-amber-400/10";

              const btnBase = "rounded-lg border px-2.5 py-1 text-xs transition-colors ";
              const btnActive = "border-cyan/60 bg-cyan/15 text-cyan font-medium";
              const btnIdle = "border-border/50 text-muted-foreground hover:border-cyan/30 hover:text-foreground";

              return (
                <motion.div key={inf.skillId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="rounded-xl border border-border/40 bg-card/40 px-4 py-3 space-y-2">
                  {/* 主层：标签 + 能力名（简洁） */}
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${tagColor}`}>{tag}</span>
                    <span className="text-sm font-medium text-foreground">{inf.skillName}</span>
                  </div>
                  {/* 你做过什么（来源） */}
                  <p className="text-xs text-muted-foreground leading-relaxed">✦ {inf.sources.slice(0, 1).join("、")}</p>
                  {/* 为什么可迁移（桥梁句） */}
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">{inf.capability}</p>
                  {/* 操作：用户确认或修正系统判断 */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-xs text-muted-foreground shrink-0">{t("adjustHint")}</span>
                    <button
                      onClick={() => {
                        setAdjustments(p => ({ ...p, [inf.skillId]: adj === "underestimated" ? undefined as any : "underestimated" }));
                        adjustLevel(inf.skillId, adj === "underestimated" ? -1 : 1);
                      }}
                      className={btnBase + (adj === "underestimated" ? btnActive : btnIdle)}
                    >{t("adjustUnderestimated")}</button>
                    <button
                      onClick={() => {
                        setAdjustments(p => ({ ...p, [inf.skillId]: adj === "overestimated" ? undefined as any : "overestimated" }));
                        adjustLevel(inf.skillId, adj === "overestimated" ? 1 : -1);
                      }}
                      className={btnBase + (adj === "overestimated" ? "border-amber-400/50 bg-amber-400/10 text-amber-400 font-medium" : btnIdle)}
                    >{t("adjustOverestimated")}</button>
                  </div>
                </motion.div>
              );
            })}
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

  // ── Fallback: no capsule data means no current_role → redirect to home ──
  router.replace("/");
  return null;
}

export default function SkillsPage() {
  const tc = useTranslations("common");
  return (<Suspense fallback={<Centered text={tc("loading")} />}><SkillsInner /></Suspense>);
}
