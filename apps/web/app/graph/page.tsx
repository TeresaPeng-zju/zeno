"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Centered } from "@/components/site/centered";
import { api, type CorrectionEvidenceOut, type QuestionOut } from "@/lib/api";


// ── 成长图（前端策展内容，纯前端状态机；只在最后把已确认节点提交给 /answers）──
// match = 该技能在 759 条真实前端 JD 里的普遍度（数据接地，不是 vibes）。
type GNode = {
  id: string; label: string; labelZh?: string; x: number; y: number;
  skill?: string; seed?: boolean; match?: number; jd?: number;
  why?: string; whyZh?: string; transferPath?: string[]; transferPathZh?: string[]; grows?: string[]; target?: boolean;
  explain?: string; explainZh?: string;
};
// 共享的 AI 能力层（各角色殊途同归）。jd = 该技能在 AI 岗位 JD 中的出现率。
const CORE: Record<string, GNode> = {
  structOut: { id: "structOut", label: "Structured Output", labelZh: "结构化输出", explain: "Make the model return a predictable JSON shape your UI can safely render.", explainZh: "让AI必须按你规定的JSON格式回答，前端可以直接、安全地渲染。", x: 360, y: 40, skill: "llm.structured_output", jd: 4, grows: ["target"] },
  fc: { id: "fc", label: "Function Calling", labelZh: "函数调用", explain: "Not a normal code call: the model chooses an API or tool and prepares its arguments.", explainZh: "不是代码里的普通函数调用，而是让模型选择API或工具，并自动生成调用参数。", x: 360, y: 190, skill: "llm.function_calling", jd: 14, grows: ["tool"] },
  rag: { id: "rag", label: "Vector Search / RAG", labelZh: "向量检索 / RAG", explain: "Let AI find evidence in your own documents before it answers.", explainZh: "让AI先从你的资料中找到相关证据，再根据证据回答。", x: 360, y: 330, skill: "data.vector_search", jd: 4, grows: ["eval"] },
  cost: { id: "cost", label: "Cost & Latency", labelZh: "成本与延迟", explain: "Keep each AI request fast enough for users and affordable enough to ship.", explainZh: "控制一次AI请求要等多久、消耗多少Token和费用，让产品真正能上线。", x: 360, y: 470, skill: "llm.cost_latency", jd: 29, grows: ["target"] },
  tool: { id: "tool", label: "Tool Orchestration (Agent)", labelZh: "工具编排（Agent）", explain: "Let AI complete several tool steps in order and recover when one fails.", explainZh: "让AI按顺序完成查资料、调用接口、整理结果，并处理失败与重试。", x: 660, y: 190, skill: "llm.tool_use", jd: 73, grows: ["target"] },
  eval: { id: "eval", label: "Evaluation · the moat", labelZh: "评估 · 护城河", explain: "Use a fixed test set and metrics to check whether AI answers are reliable.", explainZh: "用固定问题集和指标，检查AI回答是否准确、稳定、值得信任。", x: 660, y: 350, skill: "eval.offline", jd: 33, grows: ["target"] },
  target: { id: "target", label: "AI Application Engineer", labelZh: "AI 应用工程师", x: 940, y: 280, target: true },
};

// 种子模板（角色间可复用的文案；match 按角色的真实 JD 统计覆盖，见
// apps/api/scripts/build_jd_evidence.py 同一标注函数在 51job 语料上的计算）。
const SEED_DEFS: Record<string, Omit<GNode, "x" | "y" | "match">> = {
  ts: { id: "ts", label: "TypeScript Engineering", labelZh: "TypeScript 工程化", skill: "eng.typescript", seed: true, why: "You already know how to constrain system behavior with types. AI engineering uses the same idea to constrain model behavior.", whyZh: "你已经懂得用类型约束系统的行为。AI 工程用的是同一个思路——约束模型的行为。", transferPath: ["TypeScript schema", "Structured Output", "Function Calling"], transferPathZh: ["TypeScript 模式", "结构化输出", "函数调用"], grows: ["structOut"] },
  api: { id: "api", label: "API Design & Contracts", labelZh: "API 设计与契约", skill: "eng.api_design", seed: true, why: "Designing API contracts is the same thinking as defining tool inputs for an LLM.", whyZh: "设计 API 契约，和为 LLM 定义工具输入是同一种思维。", transferPath: ["API contracts", "Tool inputs", "RAG / orchestration"], transferPathZh: ["API 契约", "工具输入", "RAG / 编排"], grows: ["fc", "rag"] },
  deploy: { id: "deploy", label: "Deployment / CI·CD", labelZh: "部署 / CI·CD", skill: "eng.deploy", seed: true, why: "Your deployment and reliability thinking transfers directly to latency & cost tradeoffs in AI apps.", whyZh: "你的部署与可靠性思维，可以直接迁移到 AI 应用的延迟与成本权衡上。", transferPath: ["Deployment thinking", "Latency & cost", "AI app reliability"], transferPathZh: ["部署思维", "延迟与成本", "AI 应用可靠性"], grows: ["cost"] },
  err: { id: "err", label: "Error Handling", labelZh: "错误处理", skill: "eng.error_handling", seed: true, why: "Handling API failures is the same muscle as tool-call retries and fallbacks.", whyZh: "处理 API 失败，和工具调用的重试与兜底是同一块肌肉。", transferPath: ["Error handling", "Tool-call fallback", "Reliable agents"], transferPathZh: ["错误处理", "工具调用兜底", "可靠 Agent"], grows: ["fc"] },
  stream: { id: "stream", label: "SSE / Streaming", labelZh: "SSE / 流式", skill: "llm.streaming", seed: true, why: "Your frontend SSE experience is literally what LLM streaming integration needs.", whyZh: "你的前端 SSE 经验，正是 LLM 流式集成需要的能力。", transferPath: ["Frontend SSE", "LLM streaming", "Realtime AI UX"], transferPathZh: ["前端 SSE", "LLM 流式", "实时 AI 体验"], grows: ["target"] },
  obs: { id: "obs", label: "Observability", labelZh: "可观测性（日志/监控）", skill: "eng.observability", seed: true, why: "You already watch systems through logs and metrics. Evaluating LLM quality is the same discipline — new signals, same eyes.", whyZh: "你已经会用日志和指标看清系统——评估 LLM 质量用的是同一双眼睛，只是换了信号。", transferPath: ["Observability", "Quality signals", "LLM evaluation"], transferPathZh: ["可观测性", "质量信号", "LLM 评估"], grows: ["eval"] },
  auth: { id: "auth", label: "Auth & Permissions", labelZh: "鉴权与权限", skill: "eng.auth", seed: true, why: "You've drawn permission boundaries for systems. Giving an agent safe access to tools is the same security instinct.", whyZh: "你给系统划过权限边界——给 Agent 的工具划边界，是同一种安全直觉。", transferPath: ["Auth & permissions", "Tool boundaries", "Trusted agents"], transferPathZh: ["鉴权与权限", "工具权限边界", "可信 Agent"], grows: ["tool"] },
};

// 每个角色：种子顺序 + 真实匹配度（同一标注函数对该角色 JD 子集的统计）。
const ROLE_VARIANTS: Record<string, { seeds: [string, number, string[]?][] }> = {
  // 759 条前端 JD
  frontend: { seeds: [["ts", 61], ["api", 43], ["deploy", 14], ["err", 7], ["stream", 4]] },
  // 595 条后端 JD；api 额外长出 structOut（schema 契约思维）
  backend: { seeds: [["api", 48, ["structOut", "fc", "rag"]], ["deploy", 30], ["err", 17], ["obs", 12], ["auth", 3]] },
  // 403 条全栈 JD
  fullstack: { seeds: [["ts", 76], ["api", 70], ["deploy", 45], ["err", 19], ["obs", 12]] },
};

const SEED_Y = [60, 180, 300, 420, 540];

function buildVariant(roleKey: string): { GRAPH: Record<string, GNode>; SEEDS: string[] } {
  const variant = ROLE_VARIANTS[roleKey] ?? ROLE_VARIANTS.frontend;
  const graph: Record<string, GNode> = { ...CORE };
  const seeds: string[] = [];
  variant.seeds.forEach(([id, match, growsOverride], i) => {
    const def = SEED_DEFS[id];
    graph[id] = { ...def, x: 40, y: SEED_Y[i], match, ...(growsOverride ? { grows: growsOverride } : {}) };
    seeds.push(id);
  });
  return { GRAPH: graph, SEEDS: seeds };
}

function roleKeyOf(currentRole: string | null): "frontend" | "backend" | "fullstack" {
  if (currentRole?.startsWith("backend")) return "backend";
  if (currentRole?.startsWith("fullstack") || currentRole?.startsWith("full_stack")) return "fullstack";
  return "frontend";
}
const DEPTH = [1, 2, 3, 4];
const LVL_VAL: Record<number, string> = { 0: "none", 1: "tutorial", 2: "demo", 3: "shipped", 4: "expert" };
const MAX_PROBES = 4;

type NData = Record<string, unknown> & { label: string; state: "seed" | "avail" | "confirmed" | "gap" | "target"; sub?: string; match?: number; matchLabel?: string; explain?: string };

function GNodeView({ data }: NodeProps) {
  const d = data as NData;
  const glow =
    d.state === "confirmed" ? "border-cyan/50 text-cyan shadow-[0_0_28px_-6px_rgba(27,229,238,0.55)]"
      : d.state === "target" ? "border-gold/50 text-gold shadow-[0_0_34px_-6px_rgba(255,184,0,0.55)]"
      : d.state === "gap" ? "border-white/10 text-muted-foreground/55 opacity-70"
      : d.state === "seed" ? "border-white/12 text-foreground/90"
      : "border-purple-400/35 text-purple-200/90 shadow-[0_0_22px_-8px_rgba(168,85,247,0.5)]";
  const dot =
    d.state === "confirmed" ? "bg-cyan shadow-[0_0_10px_#1BE5EE]"
      : d.state === "target" ? "bg-gold shadow-[0_0_10px_#FFB800]"
      : d.state === "avail" ? "bg-purple-400 shadow-[0_0_8px_#a855f7]"
      : d.state === "gap" ? "bg-white/25"
      : "bg-cyan/60";
  const pulse = d.state === "confirmed" || d.state === "target";
  return (
    <div className={"group min-w-[140px] cursor-pointer rounded-2xl border bg-white/[0.04] px-3.5 py-2.5 backdrop-blur-xl transition-all duration-300 hover:bg-white/[0.07] " + glow}>
      <Handle type="target" position={Position.Left} className="!border-0 !bg-transparent" />
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          {pulse && <span className={"absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 " + (d.state === "target" ? "bg-gold" : "bg-cyan")} />}
          <span className={"relative h-2 w-2 rounded-full " + dot} />
        </span>
        <span className="text-xs font-medium tracking-tight">{d.label}</span>
        {d.explain && (
          <span
            role="note"
            tabIndex={0}
            aria-label={d.explain}
            className="group/info relative ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-cyan/30 bg-cyan/[0.06] font-mono text-[9px] font-bold text-cyan/70 outline-none transition hover:border-cyan/70 hover:bg-cyan/15 hover:text-cyan focus-visible:border-cyan focus-visible:ring-2 focus-visible:ring-cyan/30"
            onClick={(event) => event.stopPropagation()}
          >
            ?
            <span className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-50 w-64 -translate-x-1/2 translate-y-1 rounded-xl border border-cyan/20 bg-[#101722]/95 px-3 py-2.5 text-left font-sans text-[11px] font-normal leading-relaxed text-slate-200 opacity-0 shadow-[0_0_28px_-8px_rgba(27,229,238,0.45)] backdrop-blur-xl transition duration-200 group-hover/info:translate-y-0 group-hover/info:opacity-100 group-focus-visible/info:translate-y-0 group-focus-visible/info:opacity-100">
              <span className="mb-1 block font-medium text-cyan">{d.label}</span>
              {d.explain}
              <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-cyan/20 bg-[#101722]" />
            </span>
          </span>
        )}
        {d.state === "avail" && <span className="ml-auto text-[10px]">✨</span>}
      </div>
      {d.state === "seed" && d.match !== undefined && (
        <div className="mt-2 pl-4">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-cyan shadow-[0_0_8px_#1BE5EE]" style={{ width: `${Math.max(6, d.match)}%` }} />
          </div>
          <p className="mt-1 text-[9px] tracking-wide text-muted-foreground/80">{d.matchLabel}</p>
        </div>
      )}
      {d.sub && <p className={"mt-1 pl-4 text-[10px] " + (d.state === "confirmed" ? "text-cyan/70" : "text-muted-foreground")}>{d.sub}</p>}
      <Handle type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </div>
  );
}
const nodeTypes = { g: GNodeView };

function GraphInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");
  const roleKey = roleKeyOf(params.get("current_role"));
  const { GRAPH, SEEDS } = useMemo(() => buildVariant(roleKey), [roleKey]);
  const t = useTranslations("graph");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  const gLabel = (g: GNode) => (zh && g.labelZh ? g.labelZh : g.label);
  const gWhy = (g: GNode) => (zh && g.whyZh ? g.whyZh : g.why ?? "");
  const gPath = (g: GNode) => (zh && g.transferPathZh ? g.transferPathZh : g.transferPath ?? []);
  const gExplain = (g: GNode) => (zh && g.explainZh ? g.explainZh : g.explain ?? "");
  const depthLabel = (lv: number) => t(`depth${lv}`);

  const [visible, setVisible] = useState<Set<string>>(() => new Set([...SEEDS, "target"]));
  const [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const [correctedNodes, setCorrectedNodes] = useState<Set<string>>(() => new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [modalPhase, setModalPhase] = useState<"ask" | "depth" | "correctionInput" | "correctionReview">("ask");
  const [confirmationMode, setConfirmationMode] = useState<"standard" | "correction">("standard");
  const [correctionText, setCorrectionText] = useState("");
  const [correctionEvidence, setCorrectionEvidence] = useState<CorrectionEvidenceOut | null>(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [reveal, setReveal] = useState<{ path: string[]; why: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [probe, setProbe] = useState<QuestionOut | null>(null);
  const [probeCount, setProbeCount] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    if (glowRef.current) { glowRef.current.style.left = `${e.clientX}px`; glowRef.current.style.top = `${e.clientY}px`; }
  }, []);

  const answeredAnchors = useMemo(() => SEEDS.filter((id) => confirmed[id] !== undefined).length, [SEEDS, confirmed]);
  const anchorsComplete = answeredAnchors === SEEDS.length;
  const evidenceProgress = Math.round(((answeredAnchors + probeCount) / (SEEDS.length + MAX_PROBES)) * 100);

  const nodes: Node<NData>[] = useMemo(() => {
    return [...visible].map((id) => {
      const g = GRAPH[id];
      const lv = confirmed[id];
      const state: NData["state"] = g.target ? "target"
        : lv === undefined ? (g.seed ? "seed" : "avail")
        : lv > 0 ? "confirmed" : "gap";
      const sub = g.target ? undefined
        : lv !== undefined ? (lv > 0 ? `${correctedNodes.has(id) ? `${t("correctedByYou")} · ` : ""}${depthLabel(lv)}` : t("notYet"))
        : g.seed ? undefined : g.jd !== undefined ? t("jobsPct", { pct: g.jd }) : undefined;
      return { id, type: "g", position: { x: g.x, y: g.y }, data: { label: gLabel(g), state, sub, explain: gExplain(g) || undefined, match: g.seed ? g.match : undefined, matchLabel: g.seed && g.match !== undefined ? t("aiMatch", { pct: g.match }) : undefined } };
    });
  }, [visible, confirmed, correctedNodes]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const id of visible) {
      if (!((confirmed[id] ?? 0) > 0)) continue;
      for (const c of GRAPH[id].grows ?? []) {
        if (visible.has(c)) out.push({ id: `${id}-${c}`, source: id, target: c, type: "smoothstep", animated: true, style: { stroke: "hsl(183 86% 52%)", strokeWidth: 1.5, filter: "drop-shadow(0 0 4px rgba(27,229,238,0.4))" } });
      }
    }
    return out;
  }, [visible, confirmed]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    const g = GRAPH[node.id];
    if (!g || g.target) return;
    setPicking(node.id);
    setModalPhase("ask");
    setConfirmationMode("standard");
    setCorrectionText("");
    setCorrectionEvidence(null);
  }, []);

  function confirmAt(level: number) {
    if (!picking) return;
    const g = GRAPH[picking];
    setConfirmed((c) => ({ ...c, [picking]: level }));
    setCorrectedNodes((previous) => {
      const next = new Set(previous);
      if (confirmationMode === "correction") next.add(picking);
      else next.delete(picking);
      return next;
    });
    if (level > 0) {
      setVisible((v) => {
        const n = new Set(v);
        for (const c of g.grows ?? []) n.add(c);
        return n;
      });
      if (g.transferPath) setReveal({ path: gPath(g), why: gWhy(g) });
    }
    setPicking(null);
  }

  async function analyzeCorrection() {
    if (!sessionId || !picking || !GRAPH[picking]?.skill || correctionText.trim().length < 12) return;
    setCorrectionBusy(true);
    setSubmitError(null);
    try {
      const evidence = await api.analyzeCorrection(sessionId, GRAPH[picking].skill!, correctionText.trim());
      setCorrectionEvidence(evidence);
      setModalPhase("correctionReview");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("correctionAnalyzeFailed"));
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function resolveCorrection(action: "confirm" | "keep") {
    if (!sessionId || !correctionEvidence) return;
    setCorrectionBusy(true);
    setSubmitError(null);
    try {
      await api.confirmCorrection(sessionId, correctionEvidence.evidence_id, action);
      if (action === "confirm") {
        setConfirmationMode("correction");
        confirmAt(correctionEvidence.rule_level);
      } else {
        setPicking(null);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("correctionConfirmFailed"));
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function finish() {
    if (!sessionId || !anchorsComplete) return;
    const skillLvl: Record<string, number> = {};
    const skillSource: Record<string, "standard" | "user_correction"> = {};
    for (const [id, lv] of Object.entries(confirmed)) {
      const sk = GRAPH[id]?.skill;
      if (sk && (skillLvl[sk] === undefined || lv > skillLvl[sk])) {
        skillLvl[sk] = lv;
        skillSource[sk] = correctedNodes.has(id) ? "user_correction" : "standard";
      }
    }
    // Nothing confirmed yet (or everything answered "not yet"): the map has no
    // signal to work with — still allow proceeding so the flow never dead-ends;
    // the engine treats an empty observation set as "all gaps".
    setSubmitting(true);
    try {
      // Use the mock-aware api client (NOT raw fetch): in NEXT_PUBLIC_USE_MOCK
      // mode there is no backend, and raw fetch would silently strand the user.
      for (const [sk, lv] of Object.entries(skillLvl)) {
        await api.submitAnswer(sessionId, sk, LVL_VAL[lv], true, skillSource[sk] ?? "standard");
      }
      const next = await api.nextQuestion(sessionId, true);
      if (next.result_ready || !next.question) router.push(`/result?session=${sessionId}`);
      else setProbe(next.question);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function answerProbe(value: string) {
    if (!sessionId || !probe) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const nextCount = probeCount + 1;
      const next = await api.submitAnswer(sessionId, probe.skill_id, value, true);
      setProbeCount(nextCount);
      if (nextCount >= MAX_PROBES) {
        router.push(`/result?session=${sessionId}`);
        return;
      }
      if (next.question) setProbe(next.question);
      else router.push(`/result?session=${sessionId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!sessionId) return <Centered text={t("missing")} tone="error" minHeight="100vh" />;

  const pickG = picking ? GRAPH[picking] : null;

  return (
    <main onMouseMove={onMove} className="relative h-[100dvh] w-full">
      {/* 全屏点阵背景：补齐顶部留白，与画布点阵同密度同色，铺满整个主层 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 [background-image:radial-gradient(hsl(222_20%_22%)_1px,transparent_1px)] [background-size:26px_26px]" />
      {/* 鼠标光晕跟随：像手电筒照在星图上 */}
      <div ref={glowRef} className="pointer-events-none fixed left-0 top-0 z-0 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan/[0.05] blur-[120px]" />
      {/* 顶部：Zippi 引导 + 成长信心条 */}
      <div className="absolute inset-x-0 top-[74px] z-30 mx-auto max-w-2xl px-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 shadow-[0_0_30px_-12px_rgba(27,229,238,0.3)] backdrop-blur-xl">
          <motion.img src="/icons/zippi/curious.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }} className="h-10 w-10 shrink-0" style={{ imageRendering: "pixelated" }} alt="" animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2.4 }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs leading-relaxed text-cyan/90">
              {probe ? t("probeProgress", { current: probeCount + 1, max: MAX_PROBES }) : answeredAnchors === 0 ? t("intro") : t("answered", { count: answeredAnchors, max: SEEDS.length })}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
              <div className="h-full rounded-full bg-cyan transition-all duration-700" style={{ width: `${evidenceProgress}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/70">{t(roleKey === "backend" ? "sourceBackend" : roleKey === "fullstack" ? "sourceFullstack" : "source")}</p>
          </div>
          {anchorsComplete && !probe && (
            <button onClick={finish} disabled={submitting} className="shrink-0 rounded-full bg-cyan px-4 py-2 text-xs font-semibold text-[hsl(222_47%_6%)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_24px_rgba(27,229,238,0.55)] active:scale-95 disabled:opacity-50">
              {submitting ? "…" : t("seeMap")}
            </button>
          )}
        </div>
      </div>

      {probe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080b12]/80 px-4 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-3xl border border-cyan/20 bg-[#121826] p-6 shadow-[0_0_60px_-16px_rgba(27,229,238,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan">{t("adaptiveProbe")}</p>
              <p className="shrink-0 rounded-full border border-cyan/20 bg-cyan/[0.06] px-3 py-1 font-mono text-[10px] tracking-wide text-cyan/80">
                {t("probeCount", { current: probeCount + 1, max: MAX_PROBES })}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
              {Array.from({ length: MAX_PROBES }, (_, index) => (
                <span key={index} className={`h-1 rounded-full transition-colors ${index <= probeCount ? "bg-cyan shadow-[0_0_8px_rgba(27,229,238,0.55)]" : "bg-white/10"}`} />
              ))}
            </div>
            <h2 className="mt-3 text-xl font-semibold text-white">{probe.text}</h2>
            {probe.help_text && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{probe.help_text}</p>}
            <div className="mt-5 grid gap-2">
              {probe.options.map((option) => (
                <button key={option.value} disabled={submitting} onClick={() => void answerProbe(option.value)} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm transition hover:border-cyan/50 hover:bg-cyan/10 disabled:opacity-50">
                  <span className="block text-slate-100">{option.label}</span>
                  {option.example && <span className="mt-1 block text-xs leading-relaxed text-slate-500">{option.example}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {submitError && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-950/90 px-4 py-2 text-xs text-red-200">{submitError}</div>}

      {/* 画布从顶部引导浮条下方开始，fitView 只在浮条以下排布，节点不会被浮条遮挡 */}
      <div className="absolute inset-x-0 bottom-0 top-[180px]">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView fitViewOptions={{ padding: 0.18 }} proOptions={{ hideAttribution: true }} nodesDraggable={false} nodesConnectable={false} minZoom={0.4} maxZoom={1.3} />
      </div>

      {/* 节点确认弹层：三按钮 → depth */}
      {pickG && (
        <div className="fixed inset-x-0 bottom-8 z-40 mx-auto w-full max-w-md px-4">
          <div className="hairline rounded-2xl bg-card/95 px-5 py-4 shadow-xl backdrop-blur-xl">
            {modalPhase === "ask" ? (
              <>
                <p className="text-center text-sm font-semibold">{gLabel(pickG)}</p>
                <p className="mb-3 mt-1 text-center text-xs text-muted-foreground">{t("checkPrompt")}</p>
                <div className="grid gap-2">
                  <button onClick={() => { setConfirmationMode("standard"); setModalPhase("depth"); }} className="rounded-lg border border-cyan/50 bg-cyan/10 px-3 py-2 text-xs font-medium text-cyan">{t("thatsMe")}</button>
                  <button onClick={() => { setConfirmationMode("correction"); setModalPhase("correctionInput"); }} className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-medium text-gold">{t("underestimated")}</button>
                  <button onClick={() => confirmAt(0)} className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">{t("notReally")}</button>
                </div>
              </>
            ) : modalPhase === "depth" ? (
              <>
                <p className="text-center text-sm font-semibold">{t("howDeep")}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {DEPTH.map((lv) => (
                    <button key={lv} onClick={() => confirmAt(lv)} className="rounded-lg border border-border/60 px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-cyan/50 hover:text-cyan">
                      <span className="block font-medium">{depthLabel(lv)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : modalPhase === "correctionInput" ? (
              <>
                <p className="text-sm font-semibold">{t("correctionInputTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("correctionInputHint")}</p>
                <textarea value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} rows={5} autoFocus placeholder={t("correctionPlaceholder")} className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-gold/50" />
                {correctionBusy && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-gold/15 bg-gold/[0.035] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
                      <span>{t("correctionProgress")}</span>
                      <span className="font-mono text-gold/70">ZENO // EVIDENCE</span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div
                        className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent"
                        animate={{ x: ["-110%", "310%"] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setModalPhase("ask")} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-muted-foreground">{t("back")}</button>
                  <button disabled={correctionBusy || correctionText.trim().length < 12} onClick={() => void analyzeCorrection()} className="flex-[2] rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-[#151006] disabled:opacity-40">{correctionBusy ? t("correctionAnalyzing") : t("correctionAnalyze")}</button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{t("correctionPrivacy")}</p>
              </>
            ) : correctionEvidence ? (
              <>
                <p className="text-sm font-semibold">{t("correctionReviewTitle", { level: correctionEvidence.rule_level, label: depthLabel(correctionEvidence.rule_level) })}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("correctionReviewHint")}</p>
                <div className="mt-3 space-y-3 rounded-xl border border-gold/20 bg-gold/[0.04] p-3">
                  <blockquote className="border-l-2 border-gold/60 pl-3 text-xs leading-relaxed text-slate-300">“{correctionEvidence.evidence_quote}”</blockquote>
                  {correctionEvidence.actions.length > 0 && <div><p className="font-mono text-[9px] uppercase tracking-wider text-gold/70">{t("correctionActions")}</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{correctionEvidence.actions.join(" · ")}</p></div>}
                  <div className="flex flex-wrap gap-2 font-mono text-[9px] text-slate-500"><span>{correctionEvidence.rule_version}</span><span>·</span><span>{correctionEvidence.provider}</span></div>
                </div>
                <p className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-xs leading-relaxed text-slate-400">
                  {t(`correctionBoundary${correctionEvidence.rule_level}`)}
                </p>
                <div className="mt-3 grid gap-2">
                  <button disabled={correctionBusy} onClick={() => void resolveCorrection("confirm")} className="rounded-lg bg-gold px-3 py-2 text-xs font-semibold text-[#151006]">{t("correctionConfirm", { level: correctionEvidence.rule_level })}</button>
                  <button disabled={correctionBusy} onClick={() => void resolveCorrection("keep")} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">{t("correctionKeep")}</button>
                  <button disabled={correctionBusy} onClick={() => setModalPhase("correctionInput")} className="text-xs text-muted-foreground hover:text-gold">{t("correctionModify")}</button>
                </div>
              </>
            ) : null}
            <button onClick={() => setPicking(null)} className="mt-2 w-full text-center text-xs text-muted-foreground">{t("cancel")}</button>
          </div>
        </div>
      )}

      {/* 迁移高光块：截图王炸（横向 from→to + 流光粒子 + border-beam）*/}
      {reveal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0A0D14]/80 px-4 backdrop-blur-md" onClick={() => setReveal(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="border-beam relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#121826] p-8 text-center shadow-[0_0_60px_-12px_rgba(27,229,238,0.4)]"
          >
            <motion.img src="/icons/zippi/happy.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }} className="mx-auto mb-5 h-20 w-20 drop-shadow-[0_0_15px_rgba(27,229,238,0.5)]" style={{ imageRendering: "pixelated" }} alt="" animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }} />
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan">{t("bridgeFound")}</p>
            <h3 className="mb-7 mt-1.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">{t("naturalMatch")}</h3>
            <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <div className="flex-1 text-right">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{t("engFoundation")}</p>
                <p className="text-base font-bold text-foreground">{reveal.path[0]}</p>
              </div>
              <div className="px-1">
                <div className="relative h-px w-12 bg-gradient-to-r from-cyan to-gold">
                  <motion.div animate={{ x: [-8, 52] }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} className="absolute top-[-2px] h-[5px] w-2 rounded-full bg-white blur-[1px]" />
                </div>
              </div>
              <div className="flex-1 text-left">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{t("aiCapability")}</p>
                <p className="text-base font-bold italic text-gold">✨ {reveal.path[reveal.path.length - 1]}</p>
              </div>
            </div>
            <p className="mt-7 text-sm leading-relaxed text-muted-foreground">{reveal.why}</p>
            <button onClick={() => setReveal(null)} className="mt-7 w-full rounded-xl bg-cyan py-3.5 text-sm font-black text-[hsl(222_47%_6%)] transition-all hover:shadow-[0_0_24px_rgba(27,229,238,0.5)] active:scale-[0.98]">{t("gotIt")}</button>
          </motion.div>
        </div>
      )}
    </main>
  );
}

export default function GraphPage() {
  const t = useTranslations("graph");
  return (
    <Suspense fallback={<Centered text={t("loading")} minHeight="100vh" />}>
      <GraphInner />
    </Suspense>
  );
}
