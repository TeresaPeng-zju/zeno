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

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

// ── 成长图（前端策展内容，纯前端状态机；只在最后把已确认节点提交给 /answers）──
// match = 该技能在 759 条真实前端 JD 里的普遍度（数据接地，不是 vibes）。
type GNode = {
  id: string; label: string; labelZh?: string; x: number; y: number;
  skill?: string; seed?: boolean; match?: number; jd?: number;
  why?: string; whyZh?: string; transferPath?: string[]; transferPathZh?: string[]; grows?: string[]; target?: boolean;
};
const GRAPH: Record<string, GNode> = {
  ts: { id: "ts", label: "TypeScript Engineering", labelZh: "TypeScript 工程化", x: 40, y: 60, skill: "eng.typescript", seed: true, match: 61, why: "You already know how to constrain system behavior with types. AI engineering uses the same idea to constrain model behavior.", whyZh: "你已经懂得用类型约束系统的行为。AI 工程用的是同一个思路——约束模型的行为。", transferPath: ["TypeScript schema", "Structured Output", "Function Calling"], transferPathZh: ["TypeScript 模式", "结构化输出", "函数调用"], grows: ["structOut"] },
  api: { id: "api", label: "API Design & Contracts", labelZh: "API 设计与契约", x: 40, y: 180, skill: "eng.api_design", seed: true, match: 43, why: "Designing API contracts is the same thinking as defining tool inputs for an LLM.", whyZh: "设计 API 契约，和为 LLM 定义工具输入是同一种思维。", transferPath: ["API contracts", "Tool inputs", "RAG / orchestration"], transferPathZh: ["API 契约", "工具输入", "RAG / 编排"], grows: ["fc", "rag"] },
  deploy: { id: "deploy", label: "Deployment / CI·CD", labelZh: "部署 / CI·CD", x: 40, y: 300, skill: "eng.deploy", seed: true, match: 14, why: "Your deployment and reliability thinking transfers directly to latency & cost tradeoffs in AI apps.", whyZh: "你的部署与可靠性思维，可以直接迁移到 AI 应用的延迟与成本权衡上。", transferPath: ["Deployment thinking", "Latency & cost", "AI app reliability"], transferPathZh: ["部署思维", "延迟与成本", "AI 应用可靠性"], grows: ["cost"] },
  err: { id: "err", label: "Error Handling", labelZh: "错误处理", x: 40, y: 420, skill: "eng.error_handling", seed: true, match: 7, why: "Handling API failures is the same muscle as tool-call retries and fallbacks.", whyZh: "处理 API 失败，和工具调用的重试与兜底是同一块肌肉。", transferPath: ["Error handling", "Tool-call fallback", "Reliable agents"], transferPathZh: ["错误处理", "工具调用兜底", "可靠 Agent"], grows: ["fc"] },
  stream: { id: "stream", label: "SSE / Streaming", labelZh: "SSE / 流式", x: 40, y: 540, skill: "llm.streaming", seed: true, match: 4, why: "Your frontend SSE experience is literally what LLM streaming integration needs.", whyZh: "你的前端 SSE 经验，正是 LLM 流式集成需要的能力。", transferPath: ["Frontend SSE", "LLM streaming", "Realtime AI UX"], transferPathZh: ["前端 SSE", "LLM 流式", "实时 AI 体验"], grows: ["target"] },

  structOut: { id: "structOut", label: "Structured Output", labelZh: "结构化输出", x: 360, y: 40, skill: "llm.structured_output", jd: 4, grows: ["target"] },
  fc: { id: "fc", label: "Function Calling", labelZh: "函数调用", x: 360, y: 190, skill: "llm.function_calling", jd: 14, grows: ["tool"] },
  rag: { id: "rag", label: "Vector Search / RAG", labelZh: "向量检索 / RAG", x: 360, y: 330, skill: "data.vector_search", jd: 4, grows: ["eval"] },
  cost: { id: "cost", label: "Cost & Latency", labelZh: "成本与延迟", x: 360, y: 470, skill: "llm.cost_latency", jd: 29, grows: ["target"] },

  tool: { id: "tool", label: "Tool Orchestration (Agent)", labelZh: "工具编排（Agent）", x: 660, y: 190, skill: "llm.tool_use", jd: 73, grows: ["target"] },
  eval: { id: "eval", label: "Evaluation · the moat", labelZh: "评估 · 护城河", x: 660, y: 350, skill: "eval.offline", jd: 33, grows: ["target"] },

  target: { id: "target", label: "AI Application Engineer", labelZh: "AI 应用工程师", x: 940, y: 280, target: true },
};
const SEEDS = ["ts", "api", "deploy", "err", "stream"];
const DEPTH = [1, 2, 3, 4];
const LVL_VAL: Record<number, string> = { 1: "tutorial", 2: "demo", 3: "shipped", 4: "expert" };

type NData = Record<string, unknown> & { label: string; state: "seed" | "avail" | "confirmed" | "gap" | "target"; sub?: string; match?: number; matchLabel?: string };

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
  const t = useTranslations("graph");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  const gLabel = (g: GNode) => (zh && g.labelZh ? g.labelZh : g.label);
  const gWhy = (g: GNode) => (zh && g.whyZh ? g.whyZh : g.why ?? "");
  const gPath = (g: GNode) => (zh && g.transferPathZh ? g.transferPathZh : g.transferPath ?? []);
  const depthLabel = (lv: number) => t(`depth${lv}`);

  const [visible, setVisible] = useState<Set<string>>(() => new Set([...SEEDS, "target"]));
  const [confirmed, setConfirmed] = useState<Record<string, number>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [modalPhase, setModalPhase] = useState<"ask" | "depth">("ask");
  const [reveal, setReveal] = useState<{ path: string[]; why: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const glowRef = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    if (glowRef.current) { glowRef.current.style.left = `${e.clientX}px`; glowRef.current.style.top = `${e.clientY}px`; }
  }, []);

  const confirmedCount = useMemo(() => Object.values(confirmed).filter((l) => l > 0).length, [confirmed]);
  const readiness = useMemo(() => Math.min(92, confirmedCount * 11), [confirmedCount]);

  const nodes: Node<NData>[] = useMemo(() => {
    return [...visible].map((id) => {
      const g = GRAPH[id];
      const lv = confirmed[id];
      const state: NData["state"] = g.target ? "target"
        : lv === undefined ? (g.seed ? "seed" : "avail")
        : lv > 0 ? "confirmed" : "gap";
      const sub = g.target ? undefined
        : lv !== undefined ? (lv > 0 ? depthLabel(lv) : t("notYet"))
        : g.seed ? undefined : g.jd !== undefined ? t("jobsPct", { pct: g.jd }) : undefined;
      return { id, type: "g", position: { x: g.x, y: g.y }, data: { label: gLabel(g), state, sub, match: g.seed ? g.match : undefined, matchLabel: g.seed && g.match !== undefined ? t("aiMatch", { pct: g.match }) : undefined } };
    });
  }, [visible, confirmed]);

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
  }, []);

  function confirmAt(level: number) {
    if (!picking) return;
    const g = GRAPH[picking];
    setConfirmed((c) => ({ ...c, [picking]: level }));
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

  async function finish() {
    if (!sessionId) return;
    const skillLvl: Record<string, number> = {};
    for (const [id, lv] of Object.entries(confirmed)) {
      const sk = GRAPH[id]?.skill;
      if (sk && lv > 0 && lv > (skillLvl[sk] ?? 0)) skillLvl[sk] = lv;
    }
    if (Object.keys(skillLvl).length === 0) return;
    setSubmitting(true);
    try {
      await Promise.all(Object.entries(skillLvl).map(([sk, lv]) =>
        fetch(`${API}/api/sessions/${sessionId}/answers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_id: sk, answer_value: LVL_VAL[lv] ?? "demo" }) })));
      router.push(`/result?session=${sessionId}`);
    } catch {
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
              {confirmedCount === 0 ? t("intro") : t("confirmed", { count: confirmedCount })}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
              <div className="h-full rounded-full bg-cyan transition-all duration-700" style={{ width: `${readiness}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/70">{t("source")}</p>
          </div>
          {confirmedCount > 0 && (
            <button onClick={finish} disabled={submitting} className="shrink-0 rounded-full bg-cyan px-4 py-2 text-xs font-semibold text-[hsl(222_47%_6%)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_24px_rgba(27,229,238,0.55)] active:scale-95 disabled:opacity-50">
              {submitting ? "…" : t("seeMap")}
            </button>
          )}
        </div>
      </div>

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
                  <button onClick={() => setModalPhase("depth")} className="rounded-lg border border-cyan/50 bg-cyan/10 px-3 py-2 text-xs font-medium text-cyan">{t("thatsMe")}</button>
                  <button onClick={() => setModalPhase("depth")} className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-medium text-gold">{t("underestimated")}</button>
                  <button onClick={() => confirmAt(0)} className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">{t("notReally")}</button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-center text-sm font-semibold">{t("howDeep")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {DEPTH.map((lv) => (
                    <button key={lv} onClick={() => confirmAt(lv)} className="rounded-lg border border-border/60 px-3 py-2 text-xs text-foreground transition-colors hover:border-cyan/50 hover:text-cyan">{depthLabel(lv)}</button>
                  ))}
                </div>
              </>
            )}
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
