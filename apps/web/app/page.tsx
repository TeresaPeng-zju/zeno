"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";

import RotatingText from "@/components/ui/rotating-text";
import TextType from "@/components/ui/text-type";
import { AuroraCss } from "@/components/aurora-css";
import { Starfield } from "@/components/starfield";
import { api, type PathRole } from "@/lib/api";
import { RolePixelIcon } from "@/components/ui/pixel-icons";


/* ---------- Simplified → Traditional Chinese map for role labels --------- */
const ZH_TW_LABELS: Record<string, string> = {
  "前端工程师": "前端工程師",
  "后端工程师": "後端工程師",
  "全栈工程师": "全端工程師",
  "学生": "學生",
  "AI 应用工程师": "AI 應用工程師",
};

/* ---------- Coming-soon role (UI-only, not returned by /api/paths) --------- */
// Student 路径在 path_config.json 里数据齐全，先在首页以"敬请期待"卡片占位，
// 不进入会话 / 不参与 currentRole 状态，等真正发布再下放。
const COMING_SOON_ROLE: { id: string; label: string; label_zh: string } = {
  id: "student",
  label: "Student",
  label_zh: "学生",
};

function roleLabel(role: { label: string; label_zh: string }, locale: string) {
  if (locale === "en") return role.label;
  if (locale === "zh-TW") return ZH_TW_LABELS[role.label_zh] || role.label_zh;
  return role.label_zh;
}

/* ---------- animation variants ------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.7, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  }),
};

/* ---------- component ---------------------------------------------------- */

export default function HomePage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // path selector state
  const [currentRoles, setCurrentRoles] = useState<PathRole[]>([]);
  const [targetRoles, setTargetRoles] = useState<PathRole[]>([]);
  const [currentRole, setCurrentRole] = useState("");
  const [lastSession, setLastSession] = useState<string | null>(null);

  // CTA 跟随鼠标的高光：用 ref 改 CSS 变量，避免重渲染
  const ctaRef = useRef<HTMLButtonElement>(null);
  const onCtaMove = useCallback((e: React.MouseEvent) => {
    const el = ctaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  }, []);

  useEffect(() => {
    try { setLastSession(localStorage.getItem("zeno:lastSession")); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let isMounted = true;
    api.paths().then((data) => {
      if (!isMounted) return;
      setCurrentRoles(data.current_roles);
      setTargetRoles(data.target_roles);
    }).catch(() => { /* 非致命：选择器空着 */ });
    return () => { isMounted = false; };
  }, []);

  function startMapping() {
    if (!currentRole) {
      setShake(true);
      return;
    }
    const target = targetRoles[0]?.id || "ai_engineer_applied";
    setLoading(true);
    api.createSession("base", currentRole).then(({ session_id }) => {
      router.push(`/graph?session=${session_id}&current_role=${currentRole}&target_role=${target}`);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : tc("backendDown"));
      setLoading(false);
    });
  }

  return (
    <main className="relative min-h-[calc(100vh_-_4rem)] overflow-x-hidden">
      {/* ── Aurora + Starfield ──────────────────────────────────────── */}
      <AuroraCss />
      <Starfield />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="container relative z-10 flex min-h-[calc(100vh_-_4rem)] flex-col items-center justify-center py-8 text-center before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:rounded-full before:bg-[radial-gradient(ellipse_at_center,rgba(10,15,30,0.4)_0%,transparent_70%)]">
        {/* title */}
        <h1 className="mt-8 cursor-default pb-3 text-5xl font-extrabold leading-[1.15] tracking-tight sm:text-7xl sm:leading-[1.2] lg:text-8xl">
          {locale === "en" ? (
            <>
              <RotatingText
                texts={t.raw("rotatingWords") as string[]}
                mainClassName="text-cyan [-webkit-text-fill-color:hsl(183_86%_52%)] overflow-hidden py-3"
                staggerFrom="last"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "-120%" }}
                staggerDuration={0.025}
                splitLevelClassName="overflow-hidden pb-2"
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
                rotationInterval={2500}
              />{" "}
              <span className="text-gradient">{t("rotatingSuffix")}</span>
            </>
          ) : (
            <TextType
              text={t.raw("typingPhrases") as string[]}
              className="text-gradient"
              typingSpeed={75}
              deletingSpeed={50}
              pauseDuration={1500}
              showCursor={true}
              cursorCharacter="_"
              cursorClassName="text-cyan/60"
              cursorBlinkDuration={0.5}
              loop={true}
            />
          )}
        </h1>

        {/* subtitle (static) */}
        <motion.p
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-2xl cursor-default text-xl leading-relaxed text-muted-foreground sm:text-2xl"
        >
          {t("subtitle")}
        </motion.p>

        {/* ── Identity Cards ────────────────────────────────────────── */}
        <motion.div
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-14 w-full max-w-3xl"
        >
          <p className="mb-6 text-center text-lg font-semibold text-foreground/80 sm:text-xl">
            {t("iAmA")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {currentRoles.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  // 骨架屏：带微弱蓝光的透明占位，保持极客感
                  <div key={i} className="h-[118px] animate-pulse rounded-2xl border border-cyan/10 bg-white/[0.02] shadow-[inset_0_0_20px_rgba(27,229,238,0.04)]" />
                ))
              : [...currentRoles, COMING_SOON_ROLE].map((role) => {
                  const isComingSoon = role.id === COMING_SOON_ROLE.id;
                  return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => {
                      if (isComingSoon) {
                        setShake(true);
                        return;
                      }
                      setCurrentRole(role.id);
                    }}
                    disabled={loading}
                    className={
                      "group relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300 active:scale-[0.97] disabled:opacity-60 " +
                      (isComingSoon
                        ? "cursor-not-allowed border-white/[0.05] bg-white/[0.01] px-4 py-7 hover:border-white/15 hover:bg-white/[0.03] hover:shadow-[inset_0_0_22px_rgba(255,255,255,0.04)]"
                        : "border-white/[0.08] bg-white/[0.02] px-4 py-7 hover:-translate-y-1 hover:border-cyan/40 hover:bg-white/[0.05] hover:shadow-[inset_0_0_22px_rgba(27,229,238,0.06)]")
                    }
                  >
                    {/* 选中高光：layoutId 在卡片间平滑滑动 */}
                    {currentRole === role.id && (
                      <motion.div
                        layoutId="roleSelected"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                        className="absolute inset-0 z-0 rounded-2xl border border-cyan/50 bg-cyan/[0.08] shadow-[0_0_28px_-8px_rgba(27,229,238,0.5)]"
                      >
                        <span className="absolute bottom-0 left-1/2 h-1 w-1/2 -translate-x-1/2 bg-cyan blur-md" />
                      </motion.div>
                    )}
                    {!isComingSoon && (
                      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-br from-cyan/[0.06] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    )}
                    <span className={"relative z-10 flex h-9 items-center justify-center transition-all duration-300 " + (isComingSoon ? "opacity-40 grayscale group-hover:scale-105" : "group-hover:scale-110 ") + (currentRole === role.id ? "[filter:drop-shadow(0_0_8px_#1BE5EE)]" : "")}>
                      <RolePixelIcon roleId={role.id} size={32} />
                    </span>
                    <span className={"relative z-10 text-base font-semibold tracking-tight transition-colors " + (isComingSoon ? "text-foreground/40" : currentRole === role.id ? "text-cyan" : "text-foreground group-hover:text-cyan")}>
                      {roleLabel(role, locale)}
                    </span>

                    {/* 敬请期待：右上角标常显 */}
                    {isComingSoon && (
                      <span className="absolute right-2 top-2 z-20 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground/45">
                        SOON
                      </span>
                    )}
                  </button>
                  );
                })}
          </div>

          {/* Target role：核心卖点 = 终点 + 奖励，选中后点亮旋转流光边 */}
          {targetRoles.length > 0 && (
            <motion.div
              initial={false}
              animate={{
                opacity: currentRole ? 1 : 0.55,
                scale: currentRole ? 1.04 : 1,
                filter: currentRole ? "grayscale(0%)" : "grayscale(100%)",
              }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 flex flex-col items-center gap-3"
            >
              <p className="text-lg font-semibold text-foreground/80 sm:text-xl">{t("targetRole")}</p>
              <div className="group relative overflow-hidden rounded-2xl p-[1.5px]">
                {/* 旋转的彗尾流光边 */}
                {currentRole && (
                  <div className="absolute -inset-[60%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0%,transparent_70%,#1BE5EE_100%)]" />
                )}
                <div className="relative z-10 flex flex-col items-center gap-2 rounded-2xl border border-cyan/20 bg-[#0a0f1e] px-10 py-6 backdrop-blur-xl">
                  <span className="flex h-10 items-center justify-center transition-transform duration-500 group-hover:scale-125">
                    <Image
                      src="/assets/ai-engineer-icon.png"
                      alt={targetRoles[0].label}
                      width={40}
                      height={40}
                      style={{ imageRendering: "pixelated" }}
                      className="pointer-events-none drop-shadow-[0_0_8px_rgba(27,229,238,0.5)]"
                    />
                  </span>
                  <span className="text-lg font-bold tracking-wider text-cyan">
                    {roleLabel(targetRoles[0], locale)}
                  </span>
                  {/* 四角像素装饰 */}
                  <div className="absolute left-2 top-2 h-1 w-1 bg-cyan/30" />
                  <div className="absolute right-2 top-2 h-1 w-1 bg-cyan/30" />
                  <div className="absolute bottom-2 left-2 h-1 w-1 bg-cyan/30" />
                  <div className="absolute bottom-2 right-2 h-1 w-1 bg-cyan/30" />
                </div>
              </div>
            </motion.div>
          )}

          {/* CTA Button — 就绪「充能」横扫 + 鼠标高光 + 未选身份抖动 + 加载转圈 */}
          <button
            ref={ctaRef}
            type="button"
            disabled={loading}
            onMouseMove={onCtaMove}
            onClick={startMapping}
            onAnimationEnd={() => setShake(false)}
            style={{ animation: shake ? "shake 0.4s ease-in-out" : undefined }}
            className={
              "group relative mt-10 overflow-hidden rounded-full px-10 py-4 text-lg font-extrabold transition-all duration-500 active:scale-[0.97] " +
              (currentRole
                ? "bg-cyan text-[hsl(222_47%_6%)] shadow-[0_0_30px_rgba(27,229,238,0.45)] hover:scale-105 hover:shadow-[0_0_44px_rgba(27,229,238,0.6)]"
                : "cursor-not-allowed border border-white/10 bg-white/[0.05] text-white/25")
            }
          >
            {/* 充能流光：仅就绪时横扫 */}
            {currentRole && !loading && (
              <motion.span
                initial={{ x: "-120%" }}
                animate={{ x: "120%" }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
              />
            )}
            {/* 鼠标跟随高光 */}
            {currentRole && (
              <span
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: "radial-gradient(140px circle at var(--x,50%) var(--y,50%), rgba(255,255,255,0.4), transparent 45%)" }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2">
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[hsl(222_47%_6%)] border-t-transparent" />}
              {loading ? t("mapping") : t("cta")}
            </span>
          </button>

          {/* Resume：浮动胶囊式通知，引导性更强 */}
          {lastSession && (
            <div className="mt-6 flex justify-center">
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                onClick={() => router.push(`/result?session=${lastSession}`)}
                className="group inline-flex items-center gap-2.5 rounded-full border border-cyan/30 bg-cyan/[0.06] px-4 py-2 text-sm text-cyan/90 backdrop-blur-xl transition-all hover:border-cyan/50 hover:bg-cyan/[0.1] hover:shadow-[0_0_20px_-6px_rgba(27,229,238,0.55)]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" />
                </span>
                {t("resume")}
                <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
              </motion.button>
            </div>
          )}

          {error && <p className="mt-3 text-center text-sm text-magenta">{error}</p>}
        </motion.div>

      </section>
    </main>
  );
}
