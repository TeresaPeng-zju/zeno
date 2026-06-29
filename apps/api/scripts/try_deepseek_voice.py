"""一次性试跑：用 DeepSeek 把『确定性引擎的结构化事实』说成『像真人顾问』的测评。

为什么存在：验证表达层（DeepSeek）的最终口吻。确定性引擎给事实，DeepSeek 只负责
讲人话——这就是产品里 result 页该有的声音。Claude 的沙箱连不上 api.deepseek.com，
所以放到这里，你在本机（能联网 + .env 有 key）跑：

    cd apps/api && python -m scripts.try_deepseek_voice

只会调用一次。FACTS 现在是你本人画像（写死方便试跑）；接进产品时，把它换成
app.domain.decision 算出来的真实结构化结果即可——prompt 不用变。
"""
from __future__ import annotations
import json, re, ssl, pathlib, urllib.request, urllib.error


def _ssl_context() -> ssl.SSLContext:
    """macOS 的 python.org 版常缺 CA 证书。优先用 certifi；没有就退回不校验
    （仅这一次性试跑脚本可接受，正式服务请用 certifi / 系统证书）。"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        print("⚠ 未装 certifi，本次跳过证书校验（仅试跑用）。永久修复见脚本注释。\n")
        return ctx

_ENV = pathlib.Path(__file__).resolve().parent.parent / ".env"


def _env(key: str) -> str | None:
    if not _ENV.exists():
        return None
    m = re.search(rf"^{key}=(.+)$", _ENV.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip().strip('"').strip("'") if m else None


SYSTEM = (
    "你是一位温暖、有经验的职业引路人——更像一个真心希望对方成功的学长，而不是面试官或教官。"
    "你正在跟一个想转 AI 应用开发的工程师面对面聊天，像在咖啡馆里轻松交谈：先让他放松、有信心，"
    "再陪他一起诚实地看清差距。你站在他这边。\n\n"

    "【语气——这点最重要】温和、体贴、鼓励。多用『你已经…』『其实你可以…』『这块值得提前准备一下』"
    "这种朋友式的说法。绝对不要用『最要命』『硬骨头』『你心里得有数』这类逼人、教训的词，也不要居高临下。"
    "可以诚实指出不足，但要让他始终感到被支持、而不是被审判。像在帮一个你看好的后辈，不是在训话。\n\n"

    "【内容铁律】只能用我给你的事实，绝不编造任何数字、技能或岗位信息；这是一次『诊断』，不是『承诺』，"
    "绝不暗示『照做就能拿 offer』；不奉承、不灌鸡汤、不堆术语；输出是连贯的一段话，不要用项目符号列表。\n\n"

    "【按这个顺序自然地说，别生硬分段】\n"
    "一、开头先真诚地肯定他简历里 1-2 个具体强项（要点名，比如 Prompt 结构、SSE、TypeScript 工程化），"
    "让他感到『你真的读懂了我、我底子不差』——不要用『能交付基础功能』这种泛泛的话。\n"
    "二、把『其实你离得没那么远』讲清楚：告诉他就绪度是多少；再温柔地宽他的心——那一长串看着吓人的缺口，"
    "多数 AI 都能帮上忙，真正要花心思的没几件，别被吓到。\n"
    "三、给他一个最值得先迈的小台阶（我会告诉你是哪一个），耐心讲清为什么这步特别适合他："
    "他已经具备的前置、补上它能解锁什么、市场为什么看重它——像在帮他一起规划，而不是下命令。\n"
    "四、轻轻提个醒：有些能力 AI 能帮你把代码写出来，但面试官会追问背后的设计取舍（比如那个具体的问题），"
    "所以值得提前想清楚——用『提醒』的口吻，不是敲打。\n"
    "五、结尾诚实又温暖，落到这层意思（措辞可以改，但意思不能丢）：我不敢跟你保证照这么走就一定能拿到 offer，"
    "没人能保证；但我能保证，这些判断都是对照真实招聘要求老老实实算出来的，不是挑你爱听的说。\n\n"

    "整体像一个温和的人在认真跟你说话，控制在 300 字以内。"
)

# —— 接进产品时换成 decision 引擎的真实输出即可 ——
FACTS = {
    "目标岗位": "AI 应用工程师",
    "就绪度": "75%（已过入门）",
    "已确认的优势（按相关度，AI 相关在前）": [
        "Prompt 结构设计(可交付)", "结构化输出/JSON schema(可交付)", "流式输出 SSE",
        "API 设计与契约", "错误处理与重试", "部署/CI·CD", "TypeScript 工程化"],
    "真正要硬啃的护城河缺口（AI 替不了，共5件）": [
        "离线评估集构建", "质量指标/幻觉率", "多工具编排", "成本与延迟优化", "召回与重排rerank"],
    "AI 能帮你实现但面试要你讲清的缺口": [
        "向量检索(pgvector/HNSW)：要能讲清 ef/m 调优与召回-延迟权衡"],
    "建议最先补的一步": "离线评估集构建",
    "为什么是这一步": [
        "已具备前置：向量化/embedding，所以是补全不是从零",
        "它解锁下游护城河：质量指标",
        "33% 的真实 AI 岗位 JD 点名要评估能力"],
    "红线": "不承诺 offer；强调这是对照真实 JD 诚实算出的差距，不是顺着用户说好话",
}


def main() -> None:
    key = _env("DEEPSEEK_API_KEY")
    if not key:
        raise SystemExit("没在 .env 找到 DEEPSEEK_API_KEY")
    base = _env("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
    model = _env("DEEPSEEK_MODEL") or "deepseek-chat"
    user = "请基于以下事实，给这位用户一段『像真人顾问开口』的能力诊断：\n" + \
        json.dumps(FACTS, ensure_ascii=False, indent=1)

    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": user}],
        "temperature": 0.7, "max_tokens": 500,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60, context=_ssl_context()) as r:
            out = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print(f"✗ DeepSeek 返回 HTTP {e.code}：\n{detail}\n")
        hint = {401: "key 无效/被吊销 → 检查 .env 里的 DEEPSEEK_API_KEY",
                402: "余额不足 → 去 DeepSeek 后台充值",
                404: "endpoint 路径不对 → 检查 DEEPSEEK_BASE_URL",
                429: "限流/超额 → 稍后再试"}.get(e.code)
        if hint:
            print("  ↳", hint)
        raise SystemExit(1)
    print("════════ DeepSeek 真表达层输出 ════════\n")
    print(out["choices"][0]["message"]["content"])
    u = out.get("usage", {})
    print(f"\n──── tokens: {u.get('total_tokens')}（约 ¥{u.get('total_tokens', 0) * 2 / 1_000_000:.4f}）────")


if __name__ == "__main__":
    main()
