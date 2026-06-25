"""Backend internationalization — English default, Chinese switchable.

Resolves a request's ``Accept-Language`` header to a supported language and
exposes a tiny message-catalog lookup (:func:`t`). The decision engine stays
language-neutral; only the *expression* layer (labels + prose) is localized,
so the deterministic plan / offline-eval baseline never forks on language.

Usage in a router::

    from app.i18n import Lang, get_lang

    @router.get(...)
    def handler(lang: Lang = Depends(get_lang)) -> ...:
        ...
"""

from typing import Literal

from fastapi import Header

from app.i18n.messages import MESSAGES

Lang = Literal["en", "zh"]
DEFAULT_LANG: Lang = "en"


def resolve_lang(accept_language: str | None) -> Lang:
    """Map an Accept-Language header to a supported language (default English).

    Only the first (highest-priority) tag is considered; ``zh*`` resolves to
    Chinese, anything else falls back to the English default.
    """
    if not accept_language:
        return DEFAULT_LANG
    first = accept_language.split(",")[0].strip().lower()
    if first.startswith("zh"):
        return "zh"
    return DEFAULT_LANG


def get_lang(accept_language: str | None = Header(default=None)) -> Lang:
    """FastAPI dependency: resolve the request language from Accept-Language."""
    return resolve_lang(accept_language)


def t(lang: Lang, key: str, **kwargs: object) -> str:
    """Look up a catalog string for ``lang`` and interpolate ``kwargs``.

    Falls back to the English catalog (then to the raw key) when a key is
    missing, so a partially-translated catalog can never crash a request.
    """
    table = MESSAGES.get(lang) or MESSAGES[DEFAULT_LANG]
    template = table.get(key)
    if template is None:
        template = MESSAGES[DEFAULT_LANG].get(key, key)
    return template.format(**kwargs) if kwargs else template


Region = Literal["cn", "intl"]
DEFAULT_REGION: Region = "intl"


def get_region(x_zeno_region: str | None = Header(default=None)) -> Region:
    """FastAPI dependency: resolve market region from X-Zeno-Region header.

    Used for weighting JD evidence sources: 'cn' prefers domestic JD data,
    'intl' prefers Field Guide / international data. Default is 'intl'.
    """
    if x_zeno_region and x_zeno_region.lower() == "cn":
        return "cn"
    return DEFAULT_REGION


# Source trust weights by region — used when evidence from multiple
# markets (domestic vs international) is available.
REGION_SOURCE_WEIGHTS: dict[Region, dict[str, float]] = {
    "cn": {
        "jd/jd_multi_2026h1": 1.0,        # domestic JD corpus → full weight
        "field_guide/builtin_2026q1": 0.3,  # international → dampened
    },
    "intl": {
        "jd/jd_multi_2026h1": 0.3,         # domestic → dampened
        "field_guide/builtin_2026q1": 1.0,  # international → full weight
    },
}


__all__ = [
    "Lang", "DEFAULT_LANG", "resolve_lang", "get_lang",
    "Region", "DEFAULT_REGION", "get_region", "REGION_SOURCE_WEIGHTS",
    "t",
]
