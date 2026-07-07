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
        string memory image = Base64.encode(bytes(_svg(p, tokenId)));
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

    // ── 星空全息风 SVG（与 App 内护照卡同一视觉语言）──
    // tokenURI 只会被链下 eth_call 读取，渲染复杂度不产生用户 gas。

    function _svg(Passport memory p, uint256 tokenId) internal pure returns (string memory) {
        return string(
            abi.encodePacked(_svgTop(tokenId), _svgJourney(p), _svgStats(p), _svgFooter(p))
        );
    }

    function _svgTop(uint256 tokenId) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 300">',
                '<defs>',
                '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">',
                '<stop offset="0" stop-color="#2a1b4e"/><stop offset="1" stop-color="#0b1120"/>',
                '</linearGradient>',
                '<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">',
                '<stop offset="0" stop-color="#a78bfa"/><stop offset="0.6" stop-color="#e879f9"/><stop offset="1" stop-color="#fcd34d"/>',
                '</linearGradient>',
                '</defs>',
                '<rect width="520" height="300" rx="16" fill="url(#bg)"/>',
                '<rect x="6" y="6" width="508" height="288" rx="12" fill="none" stroke="#a78bfa" stroke-opacity="0.45"/>',
                // star field
                '<g fill="#fff"><circle cx="96" cy="64" r="1" opacity="0.7"/><circle cx="412" cy="52" r="1" opacity="0.5"/>',
                '<circle cx="318" cy="88" r="1.4" opacity="0.45"/><circle cx="176" cy="118" r="1" opacity="0.35"/>',
                '<circle cx="452" cy="140" r="1" opacity="0.4"/><circle cx="66" cy="168" r="1.2" opacity="0.3"/>',
                '<circle cx="382" cy="180" r="1" opacity="0.35"/><circle cx="238" cy="60" r="1" opacity="0.5"/></g>',
                // holo sheen
                '<rect x="150" y="-40" width="90" height="380" fill="#fff" opacity="0.03" transform="rotate(12 195 150)"/>',
                // header band
                '<rect x="6" y="6" width="508" height="40" rx="12" fill="#fff" opacity="0.04"/>',
                '<line x1="6" y1="46" x2="514" y2="46" stroke="#fff" stroke-opacity="0.08"/>',
                // globe emblem
                '<g fill="none" stroke="#c4b5fd" stroke-width="1.4">',
                '<circle cx="38" cy="26" r="9"/><path d="M29 26h18M38 17c3 3 3 15 0 18-3-3-3-15 0-18z"/></g>',
                '<text x="56" y="31" fill="#fff" font-family="sans-serif" font-size="14" font-weight="700" letter-spacing="1">TRANSFER PASSPORT</text>',
                '<text x="488" y="31" text-anchor="end" fill="#c4b5fd" fill-opacity="0.7" font-family="monospace" font-size="11">ZENOTP No.',
                tokenId.toString(),
                '</text>',
                // soulbound stamp
                '<g transform="rotate(12 448 78)">',
                '<rect x="398" y="62" width="100" height="32" rx="5" fill="none" stroke="#e879f9" stroke-opacity="0.6" stroke-width="2"/>',
                '<text x="448" y="76" text-anchor="middle" fill="#f0abfc" fill-opacity="0.9" font-family="monospace" font-size="10" font-weight="700" letter-spacing="2">SOULBOUND</text>',
                '<text x="448" y="88" text-anchor="middle" fill="#f0abfc" fill-opacity="0.55" font-family="monospace" font-size="6.5" letter-spacing="1.5">NON-TRANSFERABLE</text>',
                '</g>'
            )
        );
    }

    function _svgJourney(Passport memory p) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '<text x="32" y="80" fill="#94a3b8" font-family="monospace" font-size="10" letter-spacing="2">FROM</text>',
                '<text x="32" y="103" fill="#e2e8f0" font-family="sans-serif" font-size="20" font-weight="600">', p.fromRole, '</text>',
                '<path d="M32 118 h14 m0 0 -4 -4 m4 4 -4 4" stroke="#c4b5fd" stroke-width="1.6" fill="none"/>',
                '<text x="54" y="122" fill="#94a3b8" font-family="monospace" font-size="10" letter-spacing="2">TO</text>',
                '<text x="32" y="146" fill="#fbbf24" font-family="sans-serif" font-size="22" font-weight="800">', p.toRole, '</text>'
            )
        );
    }

    function _svgStats(Passport memory p) internal pure returns (string memory) {
        uint256 bw = (uint256(p.readiness) * 456) / 100;
        return string(
            abi.encodePacked(
                // readiness bar
                '<text x="32" y="172" fill="#94a3b8" font-family="monospace" font-size="10" letter-spacing="2">READINESS</text>',
                '<text x="488" y="172" text-anchor="end" fill="#ddd6fe" font-family="monospace" font-size="13" font-weight="700">',
                uint256(p.readiness).toString(), '%</text>',
                '<rect x="32" y="180" width="456" height="9" rx="4.5" fill="#fff" opacity="0.1"/>',
                '<rect x="32" y="180" width="', bw.toString(), '" height="9" rx="4.5" fill="url(#bar)"/>',
                '<line x1="146" y1="180" x2="146" y2="189" stroke="#0b1120" stroke-opacity="0.5"/>',
                '<line x1="260" y1="180" x2="260" y2="189" stroke="#0b1120" stroke-opacity="0.5"/>',
                '<line x1="374" y1="180" x2="374" y2="189" stroke="#0b1120" stroke-opacity="0.5"/>',
                // stat boxes
                '<rect x="32" y="202" width="222" height="50" rx="8" fill="#fff" opacity="0.04"/>',
                '<rect x="266" y="202" width="222" height="50" rx="8" fill="#fff" opacity="0.04"/>',
                '<text x="143" y="228" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="20" font-weight="800">',
                uint256(p.strengths).toString(), '</text>',
                '<text x="143" y="244" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="9" letter-spacing="1">TRANSFERABLE STRENGTHS</text>',
                '<text x="377" y="228" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="20" font-weight="800">',
                uint256(p.gaps).toString(), '</text>',
                '<text x="377" y="244" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="9" letter-spacing="1">GAPS TO UNLOCK</text>'
            )
        );
    }

    function _svgFooter(Passport memory p) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '<line x1="32" y1="264" x2="488" y2="264" stroke="#fff" stroke-opacity="0.15" stroke-dasharray="5 5"/>',
                '<text x="260" y="281" text-anchor="middle" fill="#c4b5fd" fill-opacity="0.4" font-family="monospace" font-size="9" letter-spacing="2">',
                _mrz(p.fromRole, p.toRole),
                '</text>',
                '<text x="260" y="293" text-anchor="middle" fill="#94a3b8" fill-opacity="0.55" font-family="sans-serif" font-size="8">ON-CHAIN SVG - ERC-5192 - BASE SEPOLIA</text>',
                '</svg>'
            )
        );
    }

    /// @dev 真护照机读区（MRZ）风格的一行码：大写、非字母数字替换为 '<'，截断到 44 位，
    ///      最后把 '<' 转义为 '&lt;'（'<' 是 XML 保留字符，直接嵌入会破坏 SVG）。
    function _mrz(string memory a, string memory b) internal pure returns (string memory) {
        bytes memory s = abi.encodePacked("P<ZENO<", _up(a), "<<", _up(b), "<<<<<<<<<<");
        uint256 n = s.length < 44 ? s.length : 44;
        uint256 extra;
        for (uint256 i; i < n; i++) if (s[i] == 0x3c) extra += 3; // '<' -> '&lt;'
        bytes memory out = new bytes(n + extra);
        uint256 j;
        for (uint256 i; i < n; i++) {
            if (s[i] == 0x3c) {
                out[j++] = "&"; out[j++] = "l"; out[j++] = "t"; out[j++] = ";";
            } else {
                out[j++] = s[i];
            }
        }
        return string(out);
    }

    function _up(string memory str) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        bytes memory out = new bytes(b.length);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x61 && c <= 0x7a) out[i] = bytes1(uint8(c) - 32);
            else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)) out[i] = c;
            else out[i] = 0x3c; // '<'
        }
        return string(out);
    }
}
