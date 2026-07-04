// Zeno Transfer Passport — demo preview (no wallet, no chain, no deps).
//
// The result page shows a local preview of the Soulbound passport so the
// AI×Web3 story is fully demoable without a wallet or a deployed contract.
// The real, deployable contract lives in `contracts/TransferPassport.sol`
// (on-chain SVG, ERC-5192). To make minting live later, deploy it to Base
// Sepolia and wire an injected wallet — this file intentionally has zero
// external dependencies so the app always builds.

export type PassportData = {
  fromRole: string;
  toRole: string;
  readiness: number; // 0-100
  strengths: number;
  gaps: number;
};
