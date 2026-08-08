"""SafeLoop guard plugin for Hermes — safeloop.runtime.v1 reference adapter.

This plugin implements no policy. It translates Hermes tool calls into SafeLoop
runtime protocol actions, and for managed action families it hands execution to
SafeLoop rather than performing the side effect itself:

    Hermes tool call
      → SafeLoop ActionProposal
      → SafeLoop governance decision
      → SafeLoop managed executor performs the exact authorized action
      → result returned to Hermes

v0.2 changes two things that mattered.

1. Authorization is bound, not ambient. v0.1 set ``hasHumanApproval`` from the
   ``SAFELOOP_HERMES_APPROVED`` environment variable, so any process able to
   set that variable turned every REQUIRE_APPROVAL into ALLOW. That mechanism
   is gone. A held action now requires an approval token bound to the exact
   action fingerprint, redeemed once, in exchange for an execution permit.

2. Managed families execute inside SafeLoop. v0.1 returned "allowed" and let
   Hermes run the tool, so nothing tied the decision to the action that
   actually ran. Terminal, filesystem, git, and memory now execute through
   SafeLoop's managed executors, and ``next_call`` is never reached for them.

Tools SafeLoop cannot manage are DENIED in the certified profile rather than
passed through, because passing them through would mean claiming governance
over a path SafeLoop does not control.
"""

from __future__ import annotations

import json
import os
import shlex
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Tuple

try:  # The SDK lives in the SafeLoop repo; the plugin degrades safely without it.
    import sys

    _SDK_PATH = os.getenv("SAFELOOP_PYTHON_SDK", "/home/charleszeller/safeloop-pilot/python")
    if _SDK_PATH and _SDK_PATH not in sys.path:
        sys.path.insert(0, _SDK_PATH)
    from safeloop_client.runtime import SafeLoopRuntimeClient, SafeLoopRuntimeError
except Exception:  # pragma: no cover - exercised only when the SDK is absent
    SafeLoopRuntimeClient = None  # type: ignore[assignment]

    class SafeLoopRuntimeError(RuntimeError):  # type: ignore[no-redef]
        code = "runtime_unavailable"


# Tools SafeLoop executes itself. Reaching next_call for any of these would
# mean the decision and the side effect were not the same thing.
_SAFELOOP_EXECUTED = {"terminal", "write_file", "read_file", "patch", "memory"}

# Consequential tools SafeLoop cannot manage. Denied in the certified profile.
_UNMANAGEABLE = {
    "delegate_task", "execute_code", "browser", "computer_use",
    "cronjob", "create_cronjob", "voice_mode",
}

_GOVERNED_TOOLSETS = {
    "terminal", "file", "code_execution", "memory", "delegation",
    "cronjob", "web", "browser", "computer_use",
}

_MEMORY_WRITE_ACTIONS = {"add", "replace", "write", "store"}

# git subcommand → SafeLoop git operation. Anything absent is not a recognized
# git operation and falls back to governed shell execution.
_GIT_OPERATIONS = {
    ("status",): "status",
    ("diff",): "diff",
    ("log",): "log",
    ("show",): "show",
    ("add",): "add",
    ("commit",): "commit",
    ("push",): "push",
    ("pull",): "pull",
    ("fetch",): "fetch",
    ("checkout",): "checkout",
    ("switch",): "switch",
    ("clean",): "clean",
}


def _enabled() -> bool:
    return os.getenv("SAFELOOP_HERMES_GUARD", "").lower() in {"1", "true", "yes", "on"}


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def _client():
    """Connect to the running SafeLoop runtime.

    Returns None when the runtime is unreachable. Callers must treat that as a
    denial for consequential work, never as permission to proceed.
    """
    if SafeLoopRuntimeClient is None:
        return None
    url = _env("SAFELOOP_RUNTIME_URL")
    credential = _env("SAFELOOP_RUNTIME_CREDENTIAL")
    if not url or not credential:
        return None
    timeout = float(_env("SAFELOOP_HERMES_TIMEOUT_SECONDS", "15") or 15)
    return SafeLoopRuntimeClient(base_url=url, credential=credential, timeout=timeout)


def _session_context() -> Tuple[str, str, str]:
    """(session_id, session_credential, task_id) provided by `safeloop run`."""
    return (
        _env("SAFELOOP_SESSION_ID"),
        _env("SAFELOOP_SESSION_CREDENTIAL"),
        _env("SAFELOOP_TASK_ID"),
    )


def _blocked(message: str, detail: Dict[str, Any] | None = None) -> str:
    return json.dumps({"error": message, "status": "blocked", "safeloop": detail or {}}, ensure_ascii=False)


def _executed(result: Dict[str, Any]) -> str:
    return json.dumps(
        {
            "status": "executed_by_safeloop",
            "exit_code": result.get("exit_code"),
            "stdout": result.get("stdout"),
            "stderr": result.get("stderr"),
            "execution_id": result.get("execution_id"),
            "action_fingerprint": result.get("action_fingerprint"),
        },
        ensure_ascii=False,
    )


def _toolset_for(tool_name: str) -> str:
    try:
        from tools.registry import registry

        return registry.get_toolset_for_tool(tool_name) or ""
    except Exception:
        return ""


def _should_govern(tool_name: str) -> bool:
    if not _enabled():
        return False
    if tool_name in _SAFELOOP_EXECUTED or tool_name in _UNMANAGEABLE:
        return True
    toolset = _toolset_for(tool_name)
    return toolset in _GOVERNED_TOOLSETS or toolset.startswith("mcp-")


def _git_action(command: str, workdir: str) -> Dict[str, Any] | None:
    """Translate a git command line into a structured SafeLoop git action.

    Returns None when the command is not a git operation SafeLoop models, so it
    stays governed as an ordinary shell action rather than being silently
    reshaped into something policy would treat more leniently.
    """
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if not parts or parts[0] != "git" or len(parts) < 2:
        return None

    subcommand = parts[1]
    rest = parts[2:]

    # Force push is a distinct operation, and must not be mistaken for a push.
    if subcommand == "push" and any(flag in rest for flag in ("--force", "-f", "--force-with-lease")):
        operation = "force_push"
    elif subcommand == "reset" and "--hard" in rest:
        operation = "reset_hard"
    elif subcommand == "branch" and ("-D" in rest or "-d" in rest):
        operation = "branch_delete"
    elif subcommand == "remote" and rest and rest[0] in {"add", "set-url", "remove"}:
        operation = f"remote_{rest[0].replace('-', '_')}"
    else:
        operation = _GIT_OPERATIONS.get((subcommand,))

    if not operation:
        return None

    arguments: Dict[str, Any] = {}
    if operation == "commit":
        if "-m" in rest:
            index = rest.index("-m")
            if index + 1 < len(rest):
                arguments["message"] = rest[index + 1]
        if "message" not in arguments:
            return None  # a commit without a message we can bind is not modelled
    elif operation in {"push", "force_push", "pull"}:
        positional = [value for value in rest if not value.startswith("-")]
        arguments["remote"] = positional[0] if positional else "origin"
        arguments["ref"] = positional[1] if len(positional) > 1 else "HEAD"
    elif operation == "fetch":
        positional = [value for value in rest if not value.startswith("-")]
        arguments["remote"] = positional[0] if positional else "origin"
    elif operation == "add":
        positional = [value for value in rest if not value.startswith("-")]
        arguments["paths"] = positional or ["."]
    elif operation in {"checkout", "switch", "show"}:
        positional = [value for value in rest if not value.startswith("-")]
        if not positional:
            return None
        arguments["ref"] = positional[0]
    elif operation == "branch_delete":
        positional = [value for value in rest if not value.startswith("-")]
        if not positional:
            return None
        arguments["branch"] = positional[0]
    elif operation.startswith("remote_"):
        positional = rest[1:]
        if not positional:
            return None
        arguments["remote"] = positional[0]
        if len(positional) > 1:
            arguments["url"] = positional[1]

    return {
        "action_kind": "git",
        "operation": operation,
        "tool": "git",
        "cwd": workdir,
        "target": workdir,
        "arguments": arguments,
    }


def _action_for(tool_name: str, args: Dict[str, Any]) -> Dict[str, Any] | None:
    """Build a SafeLoop action for a Hermes tool call."""
    args = args or {}
    workspace = _env("SAFELOOP_WORKSPACE") or os.getcwd()

    if tool_name == "terminal":
        command = str(args.get("command") or "")
        workdir = str(args.get("workdir") or workspace)
        if not command:
            return None
        git = _git_action(command, workdir)
        if git:
            return git
        return {
            "action_kind": "shell",
            "operation": "exec",
            "tool": "terminal",
            "cwd": workdir,
            "arguments": {"command": command, "shell": True},
        }

    if tool_name in {"read_file", "write_file", "patch"}:
        path = args.get("path") or args.get("filepath") or args.get("file_path")
        if not path:
            return None
        operation = "read" if tool_name == "read_file" else "write"
        arguments: Dict[str, Any] = {}
        if tool_name != "read_file":
            arguments["content"] = str(args.get("content") or args.get("new_text") or "")
        return {
            "action_kind": "filesystem",
            "operation": operation,
            "tool": tool_name,
            "target": str(path),
            "cwd": workspace,
            "arguments": arguments,
        }

    return None


def _memory_candidate(args: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any] | None:
    action = str(args.get("action") or "").lower()
    if action and action not in _MEMORY_WRITE_ACTIONS:
        return None
    lesson = str(args.get("content") or args.get("old_text") or "")
    if not lesson:
        return None

    import hashlib

    material = f"{context.get('session_id') or ''}:{context.get('tool_call_id') or ''}:{lesson}"
    return {
        "memory_id": "hermes-" + hashlib.sha256(material.encode()).hexdigest()[:16],
        "memory_type": str(args.get("target") or "procedural"),
        "situation": "Hermes proposed a durable memory from the memory tool.",
        "action": action or "write",
        "outcome": "candidate memory proposed before persistence",
        "lesson": lesson,
        "confidence": float(_env("SAFELOOP_HERMES_MEMORY_CONFIDENCE", "0.75") or 0.75),
        "evidence": [context.get("tool_call_id") or context.get("session_id") or "hermes-memory-tool"],
        "reuse_conditions": ["Only reuse when the same tenant, task context, and evidence assumptions apply."],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _approval_token(fingerprint: str) -> Dict[str, Any] | None:
    """Look up an operator-granted approval token for this exact action.

    Tokens are read from a directory the operator (or an approval UI) writes to,
    keyed by action fingerprint. The token itself is bound and single-use, so
    the delivery channel does not need to be trusted — a stolen or replayed
    token still fails redemption.
    """
    directory = _env("SAFELOOP_APPROVAL_DIR")
    if not directory:
        return None
    path = Path(directory) / f"{fingerprint}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _enforce_memory(args: Dict[str, Any], context: Dict[str, Any]) -> str | None:
    candidate = _memory_candidate(args, context)
    if candidate is None:
        return None

    client = _client()
    session_id, session_credential, task_id = _session_context()
    if client is None or not session_credential:
        return _blocked(
            "SafeLoop runtime is unavailable; durable memory persistence fails closed",
            {"code": "runtime_unavailable"},
        )

    body = {"credential": session_credential, "session_id": session_id, "task_id": task_id, "candidate": candidate}
    try:
        decision = client.request("/v1/memory/propose", body)
    except SafeLoopRuntimeError as exc:
        return _blocked("SafeLoop memory governance failed closed", {"code": getattr(exc, "code", "runtime_error")})

    if not decision.get("allowed"):
        return _blocked(
            "SafeLoop blocked durable memory persistence",
            {"decision": decision.get("decision"), "reasons": decision.get("reasons")},
        )

    # Activation happens inside SafeLoop, bound to the exact governed candidate.
    try:
        result = client.request("/v1/memory/persist", {
            "credential": session_credential,
            "session_id": session_id,
            "candidate": candidate,
            "decision": decision,
            "permit": decision.get("persistence_permit"),
        })
    except SafeLoopRuntimeError as exc:
        return _blocked("SafeLoop memory persistence failed closed", {"code": getattr(exc, "code", "runtime_error")})

    if not result.get("activated"):
        return _blocked(
            "SafeLoop did not activate the durable memory",
            {"status": result.get("status"), "failure": result.get("failure")},
        )

    return json.dumps(
        {"status": "memory_governed_by_safeloop", "memory_id": result.get("memory_id"), "decision": decision.get("decision")},
        ensure_ascii=False,
    )


def on_tool_execution_middleware(**kwargs: Any) -> Any:
    tool_name = str(kwargs.get("tool_name") or "")
    args = kwargs.get("args") if isinstance(kwargs.get("args"), dict) else {}
    next_call = kwargs.get("next_call")

    if not _should_govern(tool_name):
        return next_call(args) if callable(next_call) else args

    context = {
        "task_id": kwargs.get("task_id") or "",
        "session_id": kwargs.get("session_id") or "",
        "tool_call_id": kwargs.get("tool_call_id") or "",
        "turn_id": kwargs.get("turn_id") or "",
    }

    if tool_name == "memory":
        outcome = _enforce_memory(args, context)
        # A memory tool call is fully handled by SafeLoop; Hermes must not also
        # persist it, so next_call is never reached.
        return outcome if outcome is not None else _blocked(
            "SafeLoop could not govern this memory operation", {"code": "unsupported_memory_operation"})

    if tool_name in _UNMANAGEABLE:
        return _blocked(
            f"SafeLoop cannot manage the '{tool_name}' path; it is DISABLED in the certified profile",
            {"code": "unmanaged_path", "path": tool_name},
        )

    action = _action_for(tool_name, args)
    if action is None:
        return _blocked(
            f"SafeLoop could not model the '{tool_name}' call as a governed action",
            {"code": "unmodelled_action", "tool": tool_name},
        )

    client = _client()
    session_id, session_credential, task_id = _session_context()
    if client is None or not session_credential:
        # Fail closed: no runtime means no authorization, not free rein.
        return _blocked(
            "SafeLoop runtime is unavailable; the action fails closed",
            {"code": "runtime_unavailable"},
        )

    base = {"credential": session_credential, "session_id": session_id, "task_id": task_id}

    try:
        decision = client.request("/v1/action/propose", {**base, "action": action})
    except SafeLoopRuntimeError as exc:
        return _blocked("SafeLoop governance failed closed", {"code": getattr(exc, "code", "runtime_error")})

    disposition = str(decision.get("disposition") or "")
    permit = decision.get("execution_permit")

    if disposition in {"DENY", "STOP_AGENT"}:
        return _blocked("SafeLoop denied this action", {
            "disposition": disposition,
            "explanation": decision.get("explanation"),
            "action_fingerprint": decision.get("action_fingerprint"),
        })

    if not permit:
        # Held for a human. Redeem a bound token if one has been granted for
        # this exact fingerprint; otherwise report the hold and stop.
        fingerprint = str(decision.get("action_fingerprint") or "")
        token = _approval_token(fingerprint)
        if not token:
            request = decision.get("approval_request") or {}
            return _blocked("SafeLoop requires human approval before this action", {
                "disposition": disposition,
                "approval_request_id": request.get("approval_request_id"),
                "action_fingerprint": fingerprint,
                "explanation": decision.get("explanation"),
            })

        try:
            redemption = client.request("/v1/approval/redeem", {**base, "token": token, "action": action})
        except SafeLoopRuntimeError as exc:
            return _blocked("SafeLoop approval redemption failed closed", {"code": getattr(exc, "code", "runtime_error")})

        if not redemption.get("redeemed") or not redemption.get("execution_permit"):
            return _blocked("SafeLoop rejected the approval token", {
                "failure": redemption.get("failure"),
                "reason": redemption.get("reason"),
            })
        permit = redemption["execution_permit"]

    try:
        result = client.request("/v1/action/execute", {**base, "permit": permit, "action": action})
    except SafeLoopRuntimeError as exc:
        return _blocked("SafeLoop managed execution failed closed", {"code": getattr(exc, "code", "runtime_error")})

    if result.get("status") != "EXECUTED":
        return _blocked("SafeLoop did not execute this action", {
            "status": result.get("status"),
            "rejection_reason": result.get("rejection_reason"),
        })

    # SafeLoop performed the side effect. next_call is deliberately not reached.
    return _executed(result)


class LazyInstallStillEnabled(RuntimeError):
    """Raised when runtime dependency installation could not be sealed."""


def seal_lazy_installs() -> bool:
    """Disable Hermes runtime dependency installation for this process.

    `tools/lazy_deps.py` can run `uv pip install` / `pip install` / `ensurepip`:
    network access, package installation, and third-party code placed where it
    will later execute in-process. SafeLoop does not manage that path, so a
    governed session must not be able to reach it.

    Hermes resolves the gate as:

        security.allow_lazy_installs: false   → blocked outright
        HERMES_DISABLE_LAZY_INSTALLS=1        → blocked *unless* a durable
                                                install target is configured,
                                                in which case installs are
                                                redirected there and allowed

    So sealing requires both setting the disable flag and removing the target.
    Both are read from `os.environ` on every call and the gate is evaluated at
    install time, so doing this at registration is effective and needs no
    change to the user's config.yaml — the seal is scoped to this process and
    leaves Hermes behaviour outside a governed session untouched.

    Returns True when the seal is verified against Hermes' own gate.
    """
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    os.environ.pop("HERMES_LAZY_INSTALL_TARGET", None)

    try:
        from tools import lazy_deps
    except Exception:
        # No lazy-install machinery present: nothing to seal, nothing to leak.
        return True

    try:
        return not lazy_deps._allow_lazy_installs()
    except Exception:
        # If the gate cannot be evaluated we cannot claim the path is sealed.
        return False


def _report_control_verification(control_id: str, passed: bool, detail: str) -> None:
    """Tell the runtime what this adapter verified, for operator visibility.

    Best effort and deliberately non-authoritative: enforcement is the raise
    below, not this call. A control that depended on a reporting call having
    succeeded would not be a control.
    """
    client = _client()
    session_id, session_credential, _task_id = _session_context()
    if client is None or not session_credential:
        return
    try:
        client.request("/v1/control/verify", {
            "credential": session_credential,
            "session_id": session_id,
            "control_id": control_id,
            "passed": passed,
            "verified_by": "hermes.safeloop_guard",
            "detail": detail,
        })
    except Exception:
        # Visibility must never be able to block a session that is otherwise
        # correctly sealed.
        pass


def register(ctx) -> None:
    # Fail closed: a certified profile that cannot disable dependency
    # installation is not the profile that was certified. Refusing to register
    # is louder and safer than governing tool calls while an unmanaged
    # network-and-install path stays reachable.
    if _enabled():
        sealed = seal_lazy_installs()
        _report_control_verification(
            "dependency_installation",
            sealed,
            "Hermes lazy-install gate confirmed disabled via lazy_deps._allow_lazy_installs()"
            if sealed else
            "Hermes lazy-install gate could not be confirmed disabled",
        )
        if not sealed:
            raise LazyInstallStillEnabled(
                "SafeLoop could not disable Hermes lazy dependency installation. "
                "Set `security.allow_lazy_installs: false` in config.yaml, or unset "
                "HERMES_LAZY_INSTALL_TARGET, before running a governed session."
            )

    ctx.register_middleware("tool_execution", on_tool_execution_middleware)
