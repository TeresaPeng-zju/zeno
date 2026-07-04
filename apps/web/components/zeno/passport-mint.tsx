"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "next-intl";

import type { PassportData } from "@/lib/passport";

// Self-contained bilingual labels so this demo feature needs no wallet,
// no chain, and no new translation keys.
const L = {
  zh: {
    cta: "生成我的迁移护照",
    title: "能力迁移护照",
    soulbound: "SOULBOUND · 不可转让",
    from: "起点",
    to: "目标",
    readiness: "迁移就绪度",
    strengths: "可迁移优势",
    gaps: "待解锁缺口",
    footer: "链上现场渲染 SVG · 无需 IPFS · 可部署 Base Sepolia",
    note: "预览 · 链上版本见 contracts/TransferPassport.sol",
    close: "关闭",
  },
  en: {
    cta: "Generate my Transfer Passport",
    title: "Transfer Passport",
    soulbound: "SOULBOUND · Non-transferable",
    from: "From",
    to: "To",
    readiness: "Readiness",
    strengths: "Transferable strengths",
    gaps: "Gaps to unlock",
    footer: "On-chain SVG · no IPFS · deployable to Base Sepolia",
    note: "Preview · on-chain version in contracts/TransferPassport.sol",
    close: "Close",
  },
  "zh-TW": {
    cta: "生成我的遷移護照",
    title: "能力遷移護照",
    soulbound: "SOULBOUND · 不可轉讓",
    from: "起點",
    to: "目標",
    readiness: "遷移就緒度",
    strengths: "可遷移優勢",
    gaps: "待解鎖缺口",
    footer: "鏈上現場渲染 SVG · 無需 IPFS · 可部署 Base Sepolia",
    note: "預覽 · 鏈上版本見 contracts/TransferPassport.sol",
    close: "關閉",
  },
} as const;

/**
 * "Generate my Transfer Passport" — the AI×Web3 bridge on the result page.
 * Shows a local preview of the Soulbound passport (no wallet required).
 */
export function PassportMint(props: PassportData) {
  const locale = useLocale();
  const t = L[(locale as keyof typeof L)] ?? L.en;
  const [open, setOpen] = useState(false);

  const readiness = Math.max(0, Math.min(100, Math.round(props.readiness)));

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
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 12 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm overflow-hidden rounded-2xl border border-violet-400/40 bg-gradient-to-b from-[hsl(258_60%_12%)] to-[hsl(222_47%_7%)] p-6 shadow-[0_0_60px_rgba(167,139,250,0.25)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full border border-violet-400/50 bg-violet-500/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-violet-200">
                  {t.soulbound}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">ZENOTP</span>
              </div>

              <h3 className="text-lg font-bold text-white">{t.title}</h3>

              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="rounded-md bg-white/[0.06] px-2 py-1 text-foreground">{props.fromRole}</span>
                <span className="text-violet-300">→</span>
                <span className="rounded-md bg-violet-500/20 px-2 py-1 font-semibold text-violet-100">{props.toRole}</span>
              </div>

              <div className="mt-5">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t.readiness}</span>
                  <span className="font-mono text-violet-200">{readiness}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${readiness}%` }}
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                  />
                </div>
              </div>

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

              <p className="mt-5 text-center text-[10px] leading-relaxed text-muted-foreground/70">{t.footer}</p>
              <p className="mt-1 text-center text-[10px] text-muted-foreground/50">{t.note}</p>

              <button
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-full border border-white/12 bg-white/[0.03] py-2 text-sm text-foreground transition-all hover:bg-white/[0.06]"
              >
                {t.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
