# Zeno Skill Passport（Soulbound SBT）

一枚不可转让、完全链上的「AI 原生职业身份」。前端在结果页评估完后调用 `mintOrUpdate(...)`，
把用户的 AI 就绪度 / 可迁移优势 / 缺口 / 目标角色铸成 SBT。图与元数据由合约现场渲染 SVG，无需 IPFS。

## 用 Remix 部署到 Base Sepolia（零本地工具链，约 10 分钟）

1. 装 **MetaMask**，添加 **Base Sepolia** 测试网（chainId `84532`），到水龙头领测试 ETH：
   - https://www.alchemy.com/faucets/base-sepolia 或 https://faucet.quicknode.com/base/sepolia
2. 打开 **https://remix.ethereum.org** → 新建文件 `SkillPassport.sol`，粘贴本目录的合约。
3. **Solidity Compiler** 标签：编译器选 `0.8.20+`，点 Compile（Remix 会自动拉 OpenZeppelin 依赖）。
4. **Deploy & Run** 标签：Environment 选 **"Injected Provider - MetaMask"**（确认 MetaMask 网络是 Base Sepolia）→ 点 **Deploy** → MetaMask 确认。
5. 部署成功后复制合约地址（Deployed Contracts 里），填到前端环境变量 `NEXT_PUBLIC_PASSPORT_ADDRESS`。

## 验证

- 在 Remix 里直接调 `mintOrUpdate(72, 5, 8, "AI Application Engineer")` 测试；
- 到 https://sepolia.basescan.org 搜合约地址看交易；
- 到 https://testnets.opensea.io 搜你的钱包，能看到这枚 Soulbound 护照（链上 SVG 直接渲染）。

> 合约是标准 EVM。若赛事对某条赞助方链（如 HTX）有加分，把 MetaMask 切到那条测试网、原样重新 Deploy 即可。
