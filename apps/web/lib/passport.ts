// Zeno Transfer Passport — preview + optional live on-chain mint (no deps).
//
// The result page always shows a local preview of the Soulbound passport, so
// the AI×Web3 story is demoable without a wallet. If
// `NEXT_PUBLIC_PASSPORT_ADDRESS` is set (contract deployed on Base Sepolia)
// and the visitor has an injected wallet (MetaMask), a real one-click mint is
// offered on top. The visitor signs with THEIR OWN wallet and pays their own
// (testnet) gas — the project never holds keys or funds for users, and the
// contract enforces one passport per wallet (re-mint = update, not duplicate).
//
// ABI encoding is done by hand to keep this file dependency-free.

export type PassportData = {
  /** Display name, localized to the UI language. */
  fromRole: string;
  /** Display name, localized to the UI language. */
  toRole: string;
  /**
   * Canonical English role names written on-chain (and into the MRZ line).
   * The on-chain SVG intentionally uses English — explorer/marketplace
   * rendering environments don't guarantee CJK fonts. Defaults to the
   * display names when omitted.
   */
  chainFromRole?: string;
  chainToRole?: string;
  readiness: number; // 0-100
  strengths: number;
  gaps: number;
};

// ── Chain / contract config ────────────────────────────────────────────────

export const PASSPORT_ADDRESS = process.env.NEXT_PUBLIC_PASSPORT_ADDRESS ?? "";

const CHAIN_ID_HEX = "0x14a34"; // Base Sepolia, 84532
const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // publicnode is reliable in regions where sepolia.base.org is flaky.
  rpcUrls: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

export function explorerTxUrl(hash: string) {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

export function explorerContractUrl() {
  return `https://sepolia.basescan.org/address/${PASSPORT_ADDRESS}`;
}

/** Mint is available when the contract is configured and a wallet is injected. */
export function canMint(): boolean {
  return Boolean(PASSPORT_ADDRESS) && typeof window !== "undefined" && Boolean((window as any).ethereum);
}

// ── Minimal ABI encoding for mintOrUpdate(string,string,uint8,uint16,uint16) ──

const SELECTOR = "0x13e0f24b"; // keccak256("mintOrUpdate(string,string,uint8,uint16,uint16)")[:4]

function pad32(hex: string): string {
  return hex.padStart(64, "0");
}

function uintHex(n: number): string {
  return pad32(Math.max(0, Math.floor(n)).toString(16));
}

function encodeStringTail(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return pad32(bytes.length.toString(16)) + padded;
}

export function encodeMintCall(d: PassportData): string {
  const readiness = Math.max(0, Math.min(100, Math.round(d.readiness)));
  const tail1 = encodeStringTail(d.chainFromRole ?? d.fromRole);
  const tail2 = encodeStringTail(d.chainToRole ?? d.toRole);
  const headSize = 5 * 32;
  const offset1 = headSize;
  const offset2 = headSize + tail1.length / 2;
  const head =
    pad32(offset1.toString(16)) +
    pad32(offset2.toString(16)) +
    uintHex(readiness) +
    uintHex(d.strengths) +
    uintHex(d.gaps);
  return SELECTOR + head + tail1 + tail2;
}

// ── Wallet flow ────────────────────────────────────────────────────────────

export type MintStage = "connect" | "switch" | "confirm" | "done";

/**
 * One-click mint with the visitor's injected wallet.
 * Calls `onStage` as the flow progresses; resolves with the tx hash.
 */
export async function mintPassport(
  d: PassportData,
  onStage?: (s: MintStage) => void,
): Promise<string> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("no-wallet");
  if (!PASSPORT_ADDRESS) throw new Error("no-contract");

  onStage?.("connect");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const from = accounts[0];

  onStage?.("switch");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    // 4902: chain not added yet
    if (err?.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
    } else {
      throw err;
    }
  }

  onStage?.("confirm");
  const hash: string = await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: PASSPORT_ADDRESS, data: encodeMintCall(d), value: "0x0" }],
  });

  onStage?.("done");
  return hash;
}
