import logging
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator


@contextmanager
def timed_operation(
    logger: logging.Logger,
    label: str,
    **request_fields: Any,
) -> Iterator[Callable[[str], None]]:
    """Log request start; yield a success logger; log elapsed time on failure."""
    logger.info("%s request %s", label, request_fields)
    t0 = time.perf_counter()
    try:
        yield lambda message: logger.info(
            "%s success %s (%.2fs)",
            label,
            message,
            time.perf_counter() - t0,
        )
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        logger.warning("%s failed after %.2fs: %s", label, elapsed, exc)
        raise
