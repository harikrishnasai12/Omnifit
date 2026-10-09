"""
Developer tools: "Behind the scenes" tracing and a test clock.

Off unless OMNIFIT_DEV_MODE=1 is set, and even then only for requests made
on this computer: anything that arrives through a tunnel or proxy (Cloudflare
headers, forwarded-for, a non-localhost origin) is treated as production.

- Tracing: every request records its steps (Gemma calls, catalogue searches,
  Intent Engine, weather, streamed chat events) with timings, in memory only
  (the last MAX_TRACES requests). No photos, cookies, server URLs or secrets.
- Test clock: the X-OmniFit-Dev-Date header (YYYY-MM-DD) makes the app treat
  that day as today (festivals, event countdowns, date words in the chat).
  Used to show personas at different times of the year.
"""

import collections
import contextvars
import datetime
import functools
import inspect
import itertools
import os
import time
from typing import Any, Callable, Optional

ENABLED = os.getenv("OMNIFIT_DEV_MODE") == "1"
MAX_TRACES = 300
MAX_STEPS = 200
MAX_TEXT = 160

_LOCAL_HOSTS = ("127.0.0.1", "::1", "localhost")
_PROXY_HEADERS = ("cf-connecting-ip", "cf-ray", "cf-ipcountry", "x-forwarded-for", "x-real-ip", "forwarded")

_trace: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("omnifit_trace", default=None)
_today: contextvars.ContextVar[Optional[datetime.date]] = contextvars.ContextVar("omnifit_today", default=None)
_traces: collections.deque = collections.deque(maxlen=MAX_TRACES)
_ids = itertools.count(1)


def is_local(request) -> bool:
    """Made on this computer, not through the tunnel or any proxy."""
    if not ENABLED or not request.client or request.client.host not in _LOCAL_HOSTS:
        return False
    headers = request.headers
    if any(name in headers for name in _PROXY_HEADERS):
        return False
    origin = headers.get("origin", "")
    return not origin or origin.startswith(("http://localhost:", "http://127.0.0.1:"))


# ---------------------------------------------------------
# Test clock
# ---------------------------------------------------------

def today() -> datetime.date:
    return _today.get() or datetime.date.today()


def now() -> datetime.datetime:
    """The current time, on the test day when one is set."""
    real = datetime.datetime.now()
    day = _today.get()
    return datetime.datetime.combine(day, real.time()) if day else real


# ---------------------------------------------------------
# Tracing
# ---------------------------------------------------------

def _short(value: Any) -> Any:
    if isinstance(value, str):
        return value if len(value) <= MAX_TEXT else value[:MAX_TEXT] + "…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_short(item) for item in list(value)[:8]]
    if isinstance(value, dict):
        return {str(key): _short(item) for key, item in list(value.items())[:12]}
    return str(value)[:MAX_TEXT]


def step(kind: str, label: str, ms: Optional[float] = None, **data) -> None:
    """Add one step to the current request's trace (no-op when not tracing)."""
    trace = _trace.get()
    if trace is None or len(trace["steps"]) >= MAX_STEPS:
        return
    at = (time.perf_counter() - trace["_t0"]) * 1000
    trace["steps"].append({
        "at_ms": round(at - (ms or 0), 1),
        "ms": round(ms, 1) if ms is not None else None,
        "kind": kind,
        "label": label,
        "data": _short(data),
    })
    trace["ms"] = round(max(trace["ms"] or 0, at), 1)


def traced(kind: str, label: str, summarize: Optional[Callable] = None):
    """Wrap a function so each call becomes a timed step. summarize(args,
    kwargs, result) returns the details to show."""
    def wrap(function):
        if inspect.iscoroutinefunction(function):
            @functools.wraps(function)
            async def async_wrapper(*args, **kwargs):
                if _trace.get() is None:
                    return await function(*args, **kwargs)
                started = time.perf_counter()
                result, error = None, None
                try:
                    result = await function(*args, **kwargs)
                    return result
                except Exception as exc:
                    error = type(exc).__name__
                    raise
                finally:
                    _record(kind, label, summarize, args, kwargs, result, error, started)
            return async_wrapper

        @functools.wraps(function)
        def wrapper(*args, **kwargs):
            if _trace.get() is None:
                return function(*args, **kwargs)
            started = time.perf_counter()
            result, error = None, None
            try:
                result = function(*args, **kwargs)
                return result
            except Exception as exc:
                error = type(exc).__name__
                raise
            finally:
                _record(kind, label, summarize, args, kwargs, result, error, started)
        return wrapper
    return wrap


def _record(kind, label, summarize, args, kwargs, result, error, started) -> None:
    ms = (time.perf_counter() - started) * 1000
    details = {}
    try:
        details = summarize(args, kwargs, result) if summarize else {}
    except Exception:
        details = {}
    if error:
        details["error"] = error
    step(kind, details.pop("label", label), ms, **details)


def instrument(namespace: dict, specs: dict) -> None:
    """Replace functions in a module namespace with traced versions (dev mode
    only; production keeps the originals untouched)."""
    if not ENABLED:
        return
    for name, (kind, label, summarize) in specs.items():
        if name in namespace and callable(namespace[name]):
            namespace[name] = traced(kind, label, summarize)(namespace[name])


# ---------------------------------------------------------
# Middleware and reading traces
# ---------------------------------------------------------

async def middleware(request, call_next):
    """Start a trace (and the test clock) for local /api requests in dev mode."""
    path = request.url.path
    if not ENABLED or not path.startswith("/api/") or path.startswith("/api/dev/") or not is_local(request):
        return await call_next(request)

    day = None
    header = request.headers.get("x-omnifit-dev-date", "")
    if header:
        try:
            day = datetime.date.fromisoformat(header)
        except ValueError:
            day = None

    trace = {
        "id": next(_ids),
        "started_at": time.time(),
        "method": request.method,
        "path": path,
        "persona": request.headers.get("x-omnifit-persona", "")[:40],
        "dev_date": day.isoformat() if day else None,
        "status": None,
        "ms": None,
        "steps": [],
        "_t0": time.perf_counter(),
    }
    trace_token = _trace.set(trace)
    day_token = _today.set(day)
    try:
        response = await call_next(request)
        trace["status"] = response.status_code
        return response
    finally:
        trace["ms"] = round(max(trace["ms"] or 0, (time.perf_counter() - trace["_t0"]) * 1000), 1)
        _traces.append(trace)
        _trace.reset(trace_token)
        _today.reset(day_token)


def recent(since: int = 0, persona: str = "") -> list[dict]:
    return [
        {key: value for key, value in trace.items() if not key.startswith("_")}
        for trace in list(_traces)
        if trace["id"] > since and (not persona or trace["persona"] == persona)
    ]
