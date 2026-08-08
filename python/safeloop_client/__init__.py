"""Lightweight SafeLoop client for Python agents.

This package does not implement SafeLoop policy logic in Python. It calls the
canonical SafeLoop runtime governance engine through local HTTP or the
SafeLoop CLI/stdin JSON surface.
"""

from .client import SafeLoopClient, SafeLoopClientError
from .runtime import (
    PROTOCOL_VERSION,
    ExecuteOutcome,
    RuntimeSession,
    SafeLoopRuntimeClient,
    SafeLoopRuntimeError,
    connect,
    session,
)

__all__ = [
    "SafeLoopClient",
    "SafeLoopClientError",
    # safeloop.runtime.v1 adapter SDK
    "PROTOCOL_VERSION",
    "ExecuteOutcome",
    "RuntimeSession",
    "SafeLoopRuntimeClient",
    "SafeLoopRuntimeError",
    "connect",
    "session",
]
