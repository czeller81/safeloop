"""Lightweight SafeLoop client for Python agents.

This package does not implement SafeLoop policy logic in Python. It calls the
canonical SafeLoop runtime governance engine through local HTTP or the
SafeLoop CLI/stdin JSON surface.
"""

from .client import SafeLoopClient, SafeLoopClientError

__all__ = ["SafeLoopClient", "SafeLoopClientError"]
