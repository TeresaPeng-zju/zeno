// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @notice ERC-5192：Minimal Soulbound（不可转让）接口
interface IERC5192 {
    event Locked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/// @title  Zeno Transfer Passport（能力迁移护照）
/// @notice 一枚 Soulbound（不可转让）的凭证，证明的不是"你会什么"，而是
///         "你从哪迁移到哪、走到了哪一步"：起点角色 → 目标角色 + 迁移就绪度/
///         可迁移优势/待解锁缺口。每个钱包一枚，随成长 re-mint 更新——你的
///         迁移记录属于你、可携带到任何 AI 平台，而不锁在某个平台的数据库里。
///         图与元数据完全链上（Solidity 现场渲染 SVG），无需 IPFS / 后端。
contract TransferPassport is ERC721, IERC5192 {
    using Strings for uint256;

    struct Passport {
        string fromRole;   // 起点角色，如 "Frontend Engineer"
        string toRole;     // 目标角色，如 "AI Application Engineer"
        uint8 readiness;   // 迁移就绪度 0-100
        uint16 strengths;  // 可迁移优势数
        uint16 gaps;       // 待解锁缺口数
        uint64 updatedAt;
    }

    uint256 private _nextId = 1;
    mapping(address => uint256) public passportOf; // 钱包 => tokenId（0 表示还没有）
    mapping(uint256 => Passport) private _data;

    constructor() ERC721("Zeno Transfer Passport", "ZENOTP") {}

    /// @notice 铸造你的迁移护照；已有则更新（随成长进化的迁移记录）
    /// @param fromRole 起点角色（建议传英文，避免链上 SVG 的中文字体问题）
    /// @param toRole   目标角色
    function mintOrUpdate(
        string calldata fromRole,
        string calldata toRole,
        uint8 readiness,
        uint16 strengths,
        uint16 gaps
    ) external {
        require(readiness <= 100, "readiness 0-100");
        uint256 id = passportOf[msg.sender];
        if (id == 0) {
            id = _nextId++;
            passportOf[msg.sender] = id;
            _safeMint(msg.sender, id);
            emit Locked(id);
        }
        _data[id] = Passport(fromRole, toRole, readiness, strengths, gaps, uint64(block.timestamp));
    }

    // ── Soulbound：只允许铸造/销毁，禁止转让 ──
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "Soulbound: non-transferable");
        return super._update(to, tokenId, auth);
    }

    function locked(uint256) external pure override returns (bool) {
        return true;
    }

    function supportsInterface(bytes4 id) public view override returns (bool) {
        return id == 0xb45a3c0e || super.supportsInterface(id); // ERC-5192
    }

    // ── 完全链上的元数据 + SVG ──
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Passport memory p = _data[tokenId];
        string memory image = Base64.encode(bytes(_svg(p)));
        string memory json = string(
            abi.encodePacked(
                '{"name":"Zeno Transfer Passport #', tokenId.toString(),
                '","description":"A soulbound, self-owned proof of your capability-transfer journey, issued by Zeno. It proves not what you know, but how you migrated -- and it belongs to you, portable across any AI platform.",',
                '"image":"data:image/svg+xml;base64,', image, '",',
                '"attributes":[',
                    '{"trait_type":"From Role","value":"', p.fromRole, '"},',
                    '{"trait_type":"To Role","value":"', p.toRole, '"},',
                    '{"trait_type":"AI Readiness","value":', uint256(p.readiness).toString(), '},',
                    '{"trait_type":"Transferable Strengths","value":', uint256(p.strengths).toString(), '},',
                    '{"trait_type":"Gaps to Unlock","value":', uint256(p.gaps).toString(), '}',
                ']}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _svg(Passport memory p) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300">',
                '<rect width="520" height="300" fill="#0A0D14"/>',
                '<rect x="8" y="8" width="504" height="284" rx="20" fill="none" stroke="#1BE5EE" stroke-opacity="0.25"/>',
                '<text x="32" y="50" fill="#1BE5EE" font-family="monospace" font-size="12" letter-spacing="2.5">ZENO . TRANSFER PASSPORT</text>',
                '<text x="488" y="50" text-anchor="end" fill="#94a3b8" font-family="monospace" font-size="11">SOULBOUND</text>',
                // 迁移旅程：起点 -> 目标
                '<text x="32" y="104" fill="#64748b" font-family="monospace" font-size="11" letter-spacing="2">FROM</text>',
                '<text x="32" y="132" fill="#1BE5EE" font-family="sans-serif" font-size="22" font-weight="700">', p.fromRole, '</text>',
                '<text x="32" y="160" fill="#94a3b8" font-family="monospace" font-size="14">v  migrating</text>',
                '<text x="32" y="180" fill="#64748b" font-family="monospace" font-size="11" letter-spacing="2">TO</text>',
                '<text x="32" y="208" fill="#FFB800" font-family="sans-serif" font-size="24" font-weight="800">', p.toRole, '</text>',
                // 底部数据条
                '<text x="32" y="262" fill="#ffffff" font-family="sans-serif" font-size="34" font-weight="800">', uint256(p.readiness).toString(),
                '<tspan fill="#1BE5EE" font-size="16">% ready</tspan></text>',
                '<text x="300" y="256" fill="#1BE5EE" font-family="monospace" font-size="13">', uint256(p.strengths).toString(), ' transferable</text>',
                '<text x="300" y="274" fill="#FF4D8D" font-family="monospace" font-size="13">', uint256(p.gaps).toString(), ' to unlock</text>',
                '</svg>'
            )
        );
    }
}
