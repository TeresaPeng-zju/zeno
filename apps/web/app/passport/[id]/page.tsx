"use client";

// On-chain passport verification page — /passport/[id]
//
// Reads tokenURI(id) directly from Base Sepolia via public JSON-RPC and
// renders the fully on-chain SVG + metadata. No wallet, no backend, no
// dependency on Zeno's servers: anyone (e.g. a recruiter) can open this
// link and verify the credential against the chain itself.

import { use, useEffect, useState } from "react";
import { useLocale } from "next-intl";

import { PASSPORT_ADDRESS, explorerContractUrl } from "@/lib/passport";

const RPCS = [
  "https://base-sepolia-rpc.publicnode.com",
  "https://sepolia.base.org",
  "https://base-sepolia.gateway.tenderly.co",
];

const L = {
  zh: {
    title: "链上护照验证",
    verified: "已在 Base Sepolia 链上验证",
    loading: "正在从链上读取…",
    notFound: "未找到这枚护照（tokenId 不存在或已销毁）",
    holder: "持有者",
    attributes: "链上属性",
    note: "本页面数据直接读取自区块链（tokenURI），不经过 Zeno 服务器——凭证的真实性由链本身背书。",
    soulbound: "SOULBOUND · ERC-5192 · 不可转让",
    viewToken: "在 BaseScan 查看此 Token",
    viewContract: "查看合约",
    tryZeno: "生成我自己的迁移护照 →",
  },
  en: {
    title: "On-chain Passport Verification",
    verified: "Verified on Base Sepolia",
    loading: "Reading from chain…",
    notFound: "Passport not found (tokenId does not exist)",
    holder: "Holder",
    attributes: "On-chain attributes",
    note: "This page reads tokenURI directly from the blockchain — no Zeno server involved. Authenticity is guaranteed by the chain itself.",
    soulbound: "SOULBOUND · ERC-5192 · Non-transferable",
    viewToken: "View token on BaseScan",
    viewContract: "View contract",
    tryZeno: "Generate my own Transfer Passport →",
  },
  "zh-TW": {
    title: "鏈上護照驗證",
    verified: "已在 Base Sepolia 鏈上驗證",
    loading: "正在從鏈上讀取…",
    notFound: "未找到這枚護照（tokenId 不存在或已銷毀）",
    holder: "持有者",
    attributes: "鏈上屬性",
    note: "本頁面數據直接讀取自區塊鏈（tokenURI），不經過 Zeno 伺服器——憑證的真實性由鏈本身背書。",
    soulbound: "SOULBOUND · ERC-5192 · 不可轉讓",
    viewToken: "在 BaseScan 查看此 Token",
    viewContract: "查看合約",
    tryZeno: "生成我自己的遷移護照 →",
  },
} as const;

type Meta = {
  name: string;
  description: string;
  image: string;
  attributes: { trait_type: string; value: string | number }[];
};

// ── minimal eth_call helpers (no deps) ──────────────────────────────────────

function pad32(hex: string) {
  return hex.padStart(64, "0");
}

async function ethCall(data: string): Promise<string | null> {
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: PASSPORT_ADDRESS, data }, "latest"],
        }),
      });
      const json = await res.json();
      if (json.result && json.result !== "0x") return json.result as string;
      if (json.error) return null; // revert => token doesn't exist
    } catch {
      // try next RPC
    }
  }
  return null;
}

function decodeString(result: string): string {
  const hex = result.slice(2);
  const len = parseInt(hex.slice(64, 128), 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.slice(128 + i * 2, 130 + i * 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPassport(tokenId: string): Promise<{ meta: Meta; owner: string } | null> {
  const id = pad32(BigInt(tokenId).toString(16));
  // tokenURI(uint256) = 0xc87b56dd, ownerOf(uint256) = 0x6352211e
  const [uriRes, ownerRes] = await Promise.all([
    ethCall("0xc87b56dd" + id),
    ethCall("0x6352211e" + id),
  ]);
  if (!uriRes) return null;
  const uri = decodeString(uriRes);
  const meta = JSON.parse(atob(uri.split(",")[1])) as Meta;
  const owner = ownerRes ? "0x" + ownerRes.slice(-40) : "";
  return { meta, owner };
}

// ── page ────────────────────────────────────────────────────────────────────

export default function PassportVerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const locale = useLocale();
  const t = L[(locale as keyof typeof L)] ?? L.en;

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "ok"; meta: Meta; owner: string }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetchPassport(id)
      .then((r) => alive && setState(r ? { kind: "ok", ...r } : { kind: "error" }))
      .catch(() => alive && setState({ kind: "error" }));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-2xl flex-col items-center px-4 py-12">
      <h1 className="text-xl font-bold text-white">{t.title}</h1>

      {/* verified badge */}
      <div className="mt-3 flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span className="text-sm font-semibold text-emerald-200">{t.verified}</span>
      </div>

      {state.kind === "loading" && (
        <p className="mt-16 animate-pulse text-sm text-muted-foreground">{t.loading}</p>
      )}

      {state.kind === "error" && (
        <p className="mt-16 text-sm text-rose-300/80">{t.notFound}</p>
      )}

      {state.kind === "ok" && (
        <>
          {/* the on-chain SVG itself */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.meta.image}
            alt={state.meta.name}
            className="mt-8 w-full max-w-xl rounded-2xl shadow-[0_0_60px_rgba(167,139,250,0.25)]"
          />

          <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-fuchsia-300/60">
            {t.soulbound}
          </p>

          <h2 className="mt-6 text-lg font-bold text-white">{state.meta.name}</h2>

          {state.owner && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {t.holder}: {state.owner.slice(0, 6)}…{state.owner.slice(-4)}
            </p>
          )}

          {/* attributes */}
          <div className="mt-6 grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-3">
            {state.meta.attributes.map((a) => (
              <div key={a.trait_type} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.trait_type}</div>
                <div className="mt-1 truncate text-sm font-semibold text-white">{String(a.value)}</div>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-xl text-center text-xs leading-relaxed text-muted-foreground/70">{t.note}</p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
            <a
              href={`https://sepolia.basescan.org/nft/${PASSPORT_ADDRESS}/${id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-violet-400/40 bg-violet-500/10 px-4 py-1.5 text-violet-200 transition-all hover:bg-violet-500/20"
            >
              {t.viewToken}
            </a>
            <a
              href={explorerContractUrl()}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-1.5 text-foreground transition-all hover:bg-white/[0.06]"
            >
              {t.viewContract}
            </a>
            <a
              href="/"
              className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-1.5 font-semibold text-white transition-all hover:shadow-[0_0_18px_rgba(167,139,250,0.45)]"
            >
              {t.tryZeno}
            </a>
          </div>
        </>
      )}
    </main>
  );
}
