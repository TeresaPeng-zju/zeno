
### 部署状态补记（7-7 晚）
- 线上生效合约仍为 v1：`0x1De02cffe4540F5f1a673454D838549a0D0D1028`（铸造/更新功能正常，前端已接通）
- 新版星空全息 SVG 已写入仓库 `contracts/TransferPassport.sol`，**尚未部署**——因钱包被 MetaMask 升级为 Smart Account（EIP-7702），该模式下无法发合约部署交易
- 以后想部署新版：MetaMask → 账户详情 → Smart account → Switch back to standard account，切回后按本文件流程 5 分钟搞定（viaIR 编译配置已在 Remix 工作区）
- App 内护照卡已是新版样式，demo 展示不受影响
