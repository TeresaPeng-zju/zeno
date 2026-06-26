"""Exponential back-off retry utility.

Inspired by MiroFish's `_fetch_page_with_retry()` pattern. Generic enough
for any external API call (LLM, Embedding, CDN, Zep, etc.).

Usage::

    from app.utils.retry import with_retry

    result = with_retry(
        lambda: openai_client.embeddings.create(model="text-embedding-3-small", input=texts),
        max_retries=3,
        base_delay=1.0,
        retryable=(ConnectionError, TimeoutError),
    )

For async code, use `with_retry_async`.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Default exception types worth retrying (network / rate-limit / transient).
DEFAULT_RETRYABLE: tuple[type[BaseException], ...] = (
    ConnectionError,
    TimeoutError,
    OSError,
)


def with_retry(
    fn: Callable[[], T],
    *,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter: float = 0.5,
    retryable: tuple[type[BaseException], ...] = DEFAULT_RETRYABLE,
) -> T:
    """Call *fn* with exponential back-off on retryable exceptions.

    Delay = min(base_delay * 2^attempt + random(0, jitter), max_delay).
    Non-retryable exceptions propagate immediately.
    """
    last_exc: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except retryable as exc:
            last_exc = exc
            if attempt == max_retries:
                break
            delay = min(base_delay * (2**attempt) + random.uniform(0, jitter), max_delay)
            logger.warning(
                "Retry %d/%d after %.1fs: %s: %s",
                attempt + 1,
                max_retries,
                delay,
                type(exc).__name__,
                exc,
            )
            time.sleep(delay)
    raise last_exc  # type: ignore[misc]


async def with_retry_async(
    fn: Callable[[], Awaitable[T]],
    *,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter: float = 0.5,
    retryable: tuple[type[BaseException], ...] = DEFAULT_RETRYABLE,
) -> T:
    """Async version of :func:`with_retry`."""
    last_exc: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            return await fn()
        except retryable as exc:
            last_exc = exc
            if attempt == max_retries:
                break
            delay = min(base_delay * (2**attempt) + random.uniform(0, jitter), max_delay)
            logger.warning(
                "Retry %d/%d after %.1fs: %s: %s",
                attempt + 1,
                max_retries,
                delay,
                type(exc).__name__,
                exc,
            )
            await asyncio.sleep(delay)
    raise last_exc  # type: ignore[misc]
