# Zeno Transfer Passport（能力迁移护照 · Soulbound SBT）

一枚不可转让、完全链上的凭证——它证明的不是"你会什么",而是**"你从哪迁移到哪、走到了哪一步"**:
起点角色 → 目标角色 + 迁移就绪度 / 可迁移优势 / 待解锁缺口。

**为什么要链(核心叙事):** 你的成长/迁移记录不该锁在某个平台的数据库里——它**属于你、可携带到任何 AI 学习/招聘平台**。Web2 证明"结果",Web3 让你**拥有并证明"迁移过程"**。

前端在结果页评估完后调用 `mintOrUpdate(fromRole, toRole, readiness, strengths, gaps)`,把用户的迁移旅程铸成 SBT。图与元数据由合约现场渲染 SVG(起点→目标 + 数据条),无需 IPFS。

## 用 Remix 部署到 Base Sepolia（零本地工具链，约 10 分钟）

1. 装 **MetaMask**,添加 **Base Sepolia** 测试网(chainId `84532`),到水龙头领测试 ETH:
   - https://www.alchemy.com/faucets/base-sepolia 或 https://faucet.quicknode.com/base/sepolia
2. 打开 **https://remix.ethereum.org** → 新建 `TransferPassport.sol`,粘贴本目录的合约。
3. **Solidity Compiler**:编译器选 `0.8.20+`,点 Compile(Remix 自动拉 OpenZeppelin 依赖)。
4. **Deploy & Run**:Environment 选 **"Injected Provider - MetaMask"**(确认网络是 Base Sepolia)→ **Deploy** → MetaMask 确认。
5. 复制合约地址,填到前端环境变量 `NEXT_PUBLIC_PASSPORT_ADDRESS`。

## 验证

- Remix 里直接调 `mintOrUpdate("Frontend Engineer", "AI Application Engineer", 72, 5, 8)` 测试;
- 到 https://sepolia.basescan.org 搜合约地址看交易;
- 到 https://testnets.opensea.io 搜你的钱包,能看到这枚 Soulbound 护照(链上 SVG 直接渲染"起点→目标"的迁移旅程)。

> 合约是标准 EVM。若赛事对某条赞助方链(如 HTX)有加分,把 MetaMask 切到那条测试网、原样重新 Deploy 即可。
