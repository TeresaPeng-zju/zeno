"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

import { Centered } from "@/components/site/centered";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type ExSkill = { skill_id: string; skill_name: string; level: number; confidence?: number; evidence?: string; category?: string };
type Guess = { skill_id: string; skill_name: string; confidence?: number; reason?: string; category?: string };
type Acquired = Record<string, { skill_name: string; level: number; confidence?: number; evidence?: string }>;

function levelToValue(l: number): string {
  return l >= 4 ? "expert" : l >= 3 ? "shipped" : l >= 2 ? "demo" : l >= 1 ? "tutorial" : "none";
}
function pct(c?: number): number {
  return Math.round(Math.max(0, Math.min(1, c ?? 0.8)) * 100);
}

// zippi 表情：文件存在就用对应情绪，否则回退主图（你生成表情 PNG 后丢进 /icons/zippi/ 即自动生效）
function Zippi({ mood, size = 44 }: { mood: string; size?: number }) {
  return (
    <img
      src={`/icons/zippi/${mood}.png`}
      alt="zippi"
      width={size}
      height={size}
      style={{ imageRendering: "pixelated" }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/icons/zippi.png"; }}
    />
  );
}

function InterviewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"ask" | "thinking" | "confirm">("ask");
  const [skills, setSkills] = useState<ExSkill[]>([]);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [acquired, setAcquired] = useState<Acquired>({});
  const [round, setRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // “Zipi 越来越了解你”：随已确认技能增长的信心/就绪度
  const confidence = useMemo(() => {
    const n = Object.keys(acquired).length;
    return Math.min(92, Math.round(n * 7));
  }, [acquired]);

  async function send() {
    if (!sessionId || text.trim().length < 4) return;
    setPhase("thinking");
    setErr(null);
    setRejected(new Set());
    setEditing(false);
    try {
      const r = await fetch(`${API}/api/sessions/${sessionId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      // 稍作停顿让"建立假设"的动画有呼吸感
      await new Promise((res) => setTimeout(res, 700));
      setSkills(Array.isArray(d.skills) ? d.skills : []);
      setGuesses(Array.isArray(d.guesses) ? d.guesses : []);
      setPhase("confirm");
    } catch {
      setErr("没连上后端，确认 uvicorn 在跑、且 DeepSeek key 有效。");
      setPhase("ask");
    }
  }

  function mergeAccepted(): Acquired {
    const next: Acquired = { ...acquired };
    for (const s of skills) {
      if (rejected.has(s.skill_id)) continue;
      next[s.skill_id] = { skill_name: s.skill_name, level: s.level, confidence: s.confidence, evidence: s.evidence };
    }
    for (const g of guesses) {
      if (rejected.has(g.skill_id)) continue;
      if (!next[g.skill_id]) next[g.skill_id] = { skill_name: g.skill_name, level: 2, confidence: g.confidence, evidence: g.reason };
    }
    return next;
  }

  function nextProject() {
    setAcquired(mergeAccepted());
    setText(""); setSkills([]); setGuesses([]); setRejected(new Set()); setEditing(false);
    setRound((r) => r + 1);
    setPhase("ask");
  }

  async function finish() {
    if (!sessionId) return;
    const merged = mergeAccepted();
    if (Object.keys(merged).length === 0) return;
    setSubmitting(true);
    try {
      await Promise.all(
        Object.entries(merged).map(([sid, v]) =>
          fetch(`${API}/api/sessions/${sessionId}/answers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skill_id: sid, answer_value: levelToValue(v.level) }),
          }),
        ),
      );
      router.push(`/result?session=${sessionId}`);
    } catch {
      setErr("提交失败，再试一次。");
      setSubmitting(false);
    }
  }

  function toggle(id: string) {
    setRejected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  if (!sessionId) return <Centered text="缺少 session 参数" tone="error" minHeight="100vh" />;

  const mood = phase === "thinking" ? "thinking" : phase === "confirm" ? "happy" : "curious";
  const acquiredCount = Object.keys(acquired).length;

  return (
    <main className="container relative max-w-2xl py-14">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />

      {/* 顶部：Zipi 越来越了解你（信心条） */}
      <div className="sticky top-20 z-40 mx-auto mb-8 max-w-xl">
        <div className="hairline flex items-center gap-3 rounded-2xl bg-card/85 px-4 py-3 backdrop-blur-xl">
          <Zippi mood={mood} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">Zipi 越来越了解你</span>
              <span className="text-sm font-semibold text-cyan">{confidence}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
              <div className="h-full rounded-full bg-cyan transition-all duration-700 ease-out" style={{ width: `${confidence}%` }} />
            </div>
            <p className="mt-1.5 truncate text-xs text-cyan/80">
              {acquiredCount > 0 ? `已经认识你 ${acquiredCount} 项能力` : "讲一个项目，我来认识你"}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ── 提问 ── */}
        {phase === "ask" && (
          <motion.div key="ask" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            <div className="flex items-start gap-3">
              <Zippi mood="curious" />
              <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-card/50 px-4 py-3 text-[15px] leading-relaxed">
                {round === 0
                  ? "讲一个你最有代表性的项目吧，一句话就好——我来猜你都做过什么。"
                  : "还有别的项目吗？再讲一个，我对你的判断会更准。"}
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder="例：在腾讯做过一个 Canvas 日历，几十万节点，用 Konva，处理了拖拽、缩放和性能优化…"
              className="min-h-28 w-full resize-none rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:border-cyan/50"
            />
            <div className="flex items-center justify-between">
              {err ? <span className="text-xs text-magenta">{err}</span> : <span className="text-xs text-muted-foreground/60">⌘/Ctrl + Enter 发送</span>}
              <div className="flex gap-2">
                {acquiredCount > 0 && (
                  <button onClick={finish} disabled={submitting} className="rounded-full border border-border/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:border-cyan/40 disabled:opacity-50">
                    {submitting ? "生成中…" : "够了，看我的诊断 →"}
                  </button>
                )}
                <button onClick={send} disabled={text.trim().length < 4} className="rounded-full bg-cyan px-6 py-2.5 text-sm font-semibold text-[hsl(222_47%_6%)] transition-all hover:brightness-110 disabled:opacity-40">
                  发送
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── 思考 ── */}
        {phase === "thinking" && (
          <motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 py-16 text-center">
            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
              <Zippi mood="thinking" size={64} />
            </motion.div>
            <p className="text-sm text-cyan">🧠 正在建立你的能力画像…</p>
            <p className="max-w-sm text-xs text-muted-foreground">从你刚说的话里，推断你掌握的技能与水平</p>
          </motion.div>
        )}

        {/* ── 确认 ── */}
        {phase === "confirm" && (
          <motion.div key="confirm" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="flex items-start gap-3">
              <Zippi mood="happy" />
              <div className="rounded-2xl rounded-tl-sm border border-cyan/30 bg-cyan/[0.05] px-4 py-3 text-[15px] leading-relaxed">
                懂了！我从这一句里，读到了 <b className="text-cyan">{skills.length}</b> 项能力{guesses.length > 0 ? <>，还猜你应该会另外 {guesses.length} 项</> : null}。
              </div>
            </div>

            {/* 读到的技能（带依据 + confidence） */}
            <div className="space-y-2">
              {skills.map((s, i) => {
                const off = rejected.has(s.skill_id);
                return (
                  <motion.button
                    key={s.skill_id}
                    type="button"
                    onClick={() => editing && toggle(s.skill_id)}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.12 }}
                    className={"flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all " +
                      (off ? "border-border/40 bg-card/20 opacity-50" : "border-cyan/40 bg-cyan/[0.04]")}
                  >
                    <span className="mt-0.5 text-cyan">{off ? "✗" : "✓"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{s.skill_name}</span>
                        <span className="text-xs text-cyan/80">L{s.level} · {pct(s.confidence)}%</span>
                      </div>
                      {s.evidence && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">你提到：「{s.evidence}」</p>}
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* AI 的猜测 */}
            {guesses.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">✨ 我猜你应该还做过（点掉不对的）：</p>
                <div className="flex flex-wrap gap-2">
                  {guesses.map((g, i) => {
                    const off = rejected.has(g.skill_id);
                    return (
                      <motion.button
                        key={g.skill_id}
                        type="button"
                        onClick={() => toggle(g.skill_id)}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 + i * 0.1 }}
                        title={g.reason}
                        className={"rounded-full border px-3 py-1.5 text-xs transition-all " +
                          (off ? "border-border/40 text-muted-foreground/50 line-through" : "border-purple-400/50 bg-purple-400/10 text-purple-300")}
                      >
                        {g.skill_name} · {pct(g.confidence)}%
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 确认行 */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button onClick={() => setEditing((v) => !v)} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {editing ? "✓ 改完了" : "✏️ 有几个不对，我改一下"}
              </button>
              <div className="flex gap-2">
                <button onClick={nextProject} className="rounded-full border border-border/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:border-cyan/40">
                  👍 再讲一个项目
                </button>
                <button onClick={finish} disabled={submitting} className="rounded-full bg-cyan px-6 py-2.5 text-sm font-semibold text-[hsl(222_47%_6%)] transition-all hover:brightness-110 disabled:opacity-40">
                  {submitting ? "生成中…" : "看我的诊断 →"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={<Centered text="加载中…" minHeight="100vh" />}>
      <InterviewInner />
    </Suspense>
  );
}
