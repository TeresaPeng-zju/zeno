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

/// @title  Zeno Skill Passport
/// @notice 一枚 Soulbound（不可转让）的「AI 原生职业身份」。每个钱包一枚，
///         再次 mint 会更新链上数据（自我进化的身份）。图与元数据完全链上
///         （Solidity 现场渲染 SVG），无需 IPFS / 后端。
contract SkillPassport is ERC721, IERC5192 {
    using Strings for uint256;

    struct Passport {
        uint8 readiness;   // AI 就绪度 0-100
        uint16 strengths;  // 可迁移优势数
        uint16 gaps;       // 待解锁缺口数
        string role;       // 目标角色（建议传英文，避免链上 SVG 的中文字体问题）
        uint64 updatedAt;
    }

    uint256 private _nextId = 1;
    mapping(address => uint256) public passportOf; // 钱包 => tokenId（0 表示还没有）
    mapping(uint256 => Passport) private _data;

    constructor() ERC721("Zeno Skill Passport", "ZENODNA") {}

    /// @notice 铸造你的护照；已有则更新（叙事：随成长进化的身份）
    function mintOrUpdate(
        uint8 readiness,
        uint16 strengths,
        uint16 gaps,
        string calldata role
    ) external {
        require(readiness <= 100, "readiness 0-100");
        uint256 id = passportOf[msg.sender];
        if (id == 0) {
            id = _nextId++;
            passportOf[msg.sender] = id;
            _safeMint(msg.sender, id);
            emit Locked(id);
        }
        _data[id] = Passport(readiness, strengths, gaps, role, uint64(block.timestamp));
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
                '{"name":"Zeno Skill Passport #', tokenId.toString(),
                '","description":"A soulbound, self-evolving AI-native career identity, issued by Zeno.",',
                '"image":"data:image/svg+xml;base64,', image, '",',
                '"attributes":[',
                    '{"trait_type":"AI Readiness","value":', uint256(p.readiness).toString(), '},',
                    '{"trait_type":"Transferable Strengths","value":', uint256(p.strengths).toString(), '},',
                    '{"trait_type":"Gaps to Unlock","value":', uint256(p.gaps).toString(), '},',
                    '{"trait_type":"Target Role","value":"', p.role, '"}',
                ']}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _svg(Passport memory p) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300">',
                '<rect width="500" height="300" fill="#0A0D14"/>',
                '<rect x="8" y="8" width="484" height="284" rx="20" fill="none" stroke="#1BE5EE" stroke-opacity="0.25"/>',
                '<text x="32" y="52" fill="#1BE5EE" font-family="monospace" font-size="13" letter-spacing="3">ZENO  AI DNA</text>',
                '<text x="468" y="52" text-anchor="end" fill="#94a3b8" font-family="monospace" font-size="12">SOULBOUND</text>',
                '<text x="32" y="150" fill="#ffffff" font-family="sans-serif" font-size="64" font-weight="800">',
                uint256(p.readiness).toString(),
                '<tspan fill="#1BE5EE" font-size="28">%</tspan></text>',
                '<text x="32" y="180" fill="#94a3b8" font-family="monospace" font-size="12" letter-spacing="2">AI-READY</text>',
                '<text x="32" y="232" fill="#FFB800" font-family="sans-serif" font-size="20" font-weight="700">',
                p.role,
                '</text>',
                '<text x="32" y="264" fill="#1BE5EE" font-family="monospace" font-size="13">',
                uint256(p.strengths).toString(),
                ' transferable</text>',
                '<text x="220" y="264" fill="#FF4D8D" font-family="monospace" font-size="13">',
                uint256(p.gaps).toString(),
                ' to unlock</text>',
                '</svg>'
            )
        );
    }
}
