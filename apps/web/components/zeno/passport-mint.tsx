"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "next-intl";

import {
  canMint,
  explorerTxUrl,
  getMyPassportId,
  mintPassport,
  type MintStage,
  type PassportData,
} from "@/lib/passport";

// Self-contained bilingual labels so this feature needs no new translation keys.
const L = {
  zh: {
    cta: "领取我的能力护照",
    title: "能力迁移护照",
    soulbound: "SOULBOUND",
    nonTransferable: "与你永久绑定",
    from: "起点",
    to: "目标",
    readiness: "迁移就绪度",
    strengths: "能力已具备",
    gaps: "能力待解锁",
    footer: "链上永久保存，可随时验证真伪",
    preview: "本地预览",
    mint: "领取链上护照",
    minting: {
      connect: "连接钱包中…",
      switch: "切换到 Base Sepolia…",
      confirm: "请在钱包中确认…",
      done: "已提交",
    } as Record<MintStage, string>,
    minted: "已领取 · 在 BaseScan 查看",
    verifyPage: "查看链上验证页",
    mintNote: "使用钱包完成签名即可领取",
    mintNoteSub: "Base Sepolia · 每个钱包保留最新版本",
    ritual: "你的能力护照已生成。它可以永久记录你的能力迁移轨迹，并在任何时候证明它属于你。",
    error: "未完成，可重试",
    close: "返回",
  },
  en: {
    cta: "Claim my Transfer Passport",
    title: "Transfer Passport",
    soulbound: "SOULBOUND",
    nonTransferable: "Bound to you",
    from: "From",
    to: "To",
    readiness: "Readiness",
    strengths: "Skills you have",
    gaps: "Skills to unlock",
    footer: "Permanently on-chain · verify anytime",
    preview: "Local preview",
    mint: "Claim on-chain passport",
    minting: {
      connect: "Connecting wallet…",
      switch: "Switching to Base Sepolia…",
      confirm: "Confirm in your wallet…",
      done: "Submitted",
    } as Record<MintStage, string>,
    minted: "Claimed · view on BaseScan",
    verifyPage: "View on-chain verification page",
    mintNote: "Sign with your wallet to claim",
    mintNoteSub: "Base Sepolia · latest version kept per wallet",
    ritual: "Your passport is ready. It permanently records your capability journey — and proves it's yours at any time.",
    error: "Not completed — try again",
    close: "Back",
  },
  "zh-TW": {
    cta: "領取我的能力護照",
    title: "能力遷移護照",
    soulbound: "SOULBOUND",
    nonTransferable: "與你永久綁定",
    from: "起點",
    to: "目標",
    readiness: "遷移就緒度",
    strengths: "能力已具備",
    gaps: "能力待解鎖",
    footer: "鏈上永久保存，可隨時驗證真偽",
    preview: "本地預覽",
    mint: "領取鏈上護照",
    minting: {
      connect: "連接錢包中…",
      switch: "切換到 Base Sepolia…",
      confirm: "請在錢包中確認…",
      done: "已提交",
    } as Record<MintStage, string>,
    minted: "已領取 · 在 BaseScan 查看",
    verifyPage: "查看鏈上驗證頁",
    mintNote: "使用錢包完成簽名即可領取",
    mintNoteSub: "Base Sepolia · 每個錢包保留最新版本",
    ritual: "你的能力護照已生成。它可以永久記錄你的能力遷移軌跡，並在任何時候證明它屬於你。",
    error: "未完成，可重試",
    close: "返回",
  },
} as const;

/** Machine-readable-zone-style footer line, like a real passport. */
function mrz(from: string, to: string): string {
  const clean = (s: string) =>
    s.toUpperCase().replace(/[^A-Z0-9]+/g, "<").replace(/<+/g, "<");
  return `P<ZENO<${clean(from)}<<${clean(to)}`.slice(0, 44).padEnd(44, "<");
}

type MintState =
  | { kind: "idle" }
  | { kind: "busy"; stage: MintStage }
  | { kind: "success"; hash: string; tokenId: number }
  | { kind: "error" };

/**
 * "Generate my Transfer Passport" — the AI×Web3 bridge on the result page.
 * Always shows a local preview; offers a real one-click mint when the
 * contract is configured and the visitor has an injected wallet.
 */
export function PassportMint(props: PassportData) {
  const locale = useLocale();
  const t = L[(locale as keyof typeof L)] ?? L.en;
  const [open, setOpen] = useState(false);
  const [mint, setMint] = useState<MintState>({ kind: "idle" });

  const readiness = Math.max(0, Math.min(100, Math.round(props.readiness)));
  const serial = `ZENOTP·${String(readiness).padStart(3, "0")}`;

  async function onMint() {
    if (mint.kind === "busy") return;
    try {
      const hash = await mintPassport(props, (stage) =>
        setMint({ kind: "busy", stage }),
      );
      const tokenId = await getMyPassportId().catch(() => 0);
      setMint({ kind: "success", hash, tokenId });
    } catch {
      setMint({ kind: "error" });
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2.5 text-sm font-bold text-white transition-all hover:scale-105 hover:shadow-[0_0_24px_rgba(167,139,250,0.5)] active:scale-95"
      >
        {t.cta}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 12, rotateX: 8 }}
              animate={{ scale: 1, y: 0, rotateX: 0 }}
              exit={{ scale: 0.92, y: 12 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-violet-400/40 bg-gradient-to-b from-[hsl(258_60%_12%)] to-[hsl(222_47%_7%)] shadow-[0_0_60px_rgba(167,139,250,0.25)]"
            >
              {/* holo sheen + star field */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  background:
                    "radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,.7) 50%, transparent 51%), radial-gradient(1px 1px at 78% 8%, rgba(255,255,255,.5) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 62% 32%, rgba(255,255,255,.45) 50%, transparent 51%), radial-gradient(1px 1px at 30% 44%, rgba(255,255,255,.35) 50%, transparent 51%), radial-gradient(1px 1px at 88% 52%, rgba(255,255,255,.4) 50%, transparent 51%)",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -left-1/3 top-0 h-full w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent"
              />

              {/* header band */}
              <div className="relative flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] px-6 py-3">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
                  </svg>
                  <span className="text-sm font-bold tracking-wide text-white">{t.title}</span>
                </div>
                <span className="font-mono text-[10px] text-violet-200/70">{serial}</span>
              </div>

              <div className="relative p-6 pt-5">
                {/* soulbound seal */}
                <div className="pointer-events-none absolute right-4 top-4 rotate-12 rounded-md border-2 border-fuchsia-400/50 px-2 py-0.5 text-center">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-fuchsia-300/90">{t.soulbound}</div>
                  <div className="font-mono text-[8px] uppercase tracking-widest text-fuchsia-300/60">{t.nonTransferable}</div>
                </div>

                {/* journey */}
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="rounded-md bg-white/[0.06] px-2 py-1 text-foreground">{props.fromRole}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-violet-300" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14m0 0-5-5m5 5-5 5" />
                  </svg>
                  <span className="rounded-md bg-amber-400/15 px-2 py-1 font-semibold text-amber-300">{props.toRole}</span>
                </div>

                {/* readiness */}
                <div className="mt-5">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t.readiness}</span>
                    <span className="font-mono text-violet-200">{readiness}%</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${readiness}%` }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-300"
                    />
                    {[25, 50, 75].map((tick) => (
                      <div key={tick} className="absolute top-0 h-full w-px bg-black/30" style={{ left: `${tick}%` }} />
                    ))}
                  </div>
                </div>

                {/* stats */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-center">
                    <div className="text-2xl font-bold text-white">{props.strengths}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{t.strengths}</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-center">
                    <div className="text-2xl font-bold text-white">{props.gaps}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{t.gaps}</div>
                  </div>
                </div>

                {/* perforation + MRZ (always canonical English, like a real passport) */}
                <div className="mt-5 border-t border-dashed border-white/15 pt-3">
                  <p className="truncate text-center font-mono text-[10px] tracking-[0.18em] text-violet-200/40">
                    {mrz(props.chainFromRole ?? props.fromRole, props.chainToRole ?? props.toRole)}
                  </p>
                  <p className="mt-1 text-center text-[10px] leading-relaxed text-muted-foreground/70">{t.footer}</p>
                </div>

                {/* actions */}
                {canMint() && (
                  <div className="mt-4">
                    {mint.kind === "success" ? (
                      <div className="space-y-2">
                        <a
                          href={explorerTxUrl(mint.hash)}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-full rounded-full border border-emerald-400/40 bg-emerald-500/15 py-2 text-center text-sm font-semibold text-emerald-200 transition-all hover:bg-emerald-500/25"
                        >
                          ✓ {t.minted}
                        </a>
                        {mint.tokenId > 0 && (
                          <a
                            href={`/passport/${mint.tokenId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-full rounded-full border border-violet-400/40 bg-violet-500/10 py-2 text-center text-sm font-semibold text-violet-200 transition-all hover:bg-violet-500/20"
                          >
                            {t.verifyPage}
                          </a>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={onMint}
                        disabled={mint.kind === "busy"}
                        className="w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2 text-sm font-bold text-white transition-all hover:shadow-[0_0_18px_rgba(167,139,250,0.45)] disabled:opacity-60"
                      >
                        {mint.kind === "busy" ? t.minting[mint.stage] : t.mint}
                      </button>
                    )}
                    {mint.kind === "error" && (
                      <p className="mt-1.5 text-center text-[11px] text-rose-300/80">{t.error}</p>
                    )}
                    <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">{t.mintNote}</p>
                  </div>
                )}

                <button
                  onClick={() => setOpen(false)}
                  className="mt-4 w-full rounded-full border border-white/12 bg-white/[0.03] py-2 text-sm text-foreground transition-all hover:bg-white/[0.06]"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
