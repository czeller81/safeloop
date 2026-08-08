"""SafeLoop runtime SDK for Python agents.

This is a first-class adapter SDK for ``safeloop.runtime.v1``, not a wrapper
around the CLI. It speaks the same protocol as the TypeScript SDK and shares
the same runtime, so a Python adapter and a TypeScript adapter get identical
decisions for identical actions.

There is deliberately no policy in this file. Every disposition, permit, and
memory decision comes from the runtime. A Python-side policy model would be a
second implementation to keep in sync, and the two would eventually disagree.

Typical use::

    with safeloop.session(agent_id="my-agent", tenant_id="acme", workspace=".") as session:
        task = session.start_task(goal="run the test suite")
        result = session.execute_shell(["npm", "test"], task_id=task)
        if result.held:
            grant = session.client.grant_approval(result.approval_request_id, "operator")
            result = session.execute_approved(result.proposal, task, grant["token"])
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

__all__ = [
    "SafeLoopRuntimeClient",
    "SafeLoopRuntimeError",
    "RuntimeSession",
    "ExecuteOutcome",
    "connect",
    "session",
]

PROTOCOL_VERSION = "safeloop.runtime.v1"


class SafeLoopRuntimeError(RuntimeError):
    """Raised when the runtime refuses a call or cannot be reached.

    ``code`` carries the runtime's machine-readable reason (for example
    ``unauthenticated`` or ``privilege_widening``) so adapters can branch on it
    without parsing messages.
    """

    def __init__(self, message: str, *, code: str = "runtime_error", status: int = 0):
        super().__init__(message)
        self.code = code
        self.status = status


def _connection_file(base_dir: str | os.PathLike[str] | None = None) -> Path:
    root = Path(base_dir) if base_dir else Path.cwd()
    return root / ".safeloop" / "runtime" / "runtime-credential.json"


def _read_connection(base_dir: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    path = _connection_file(base_dir)
    if not path.exists():
        raise SafeLoopRuntimeError(
            f"No SafeLoop runtime connection file at {path}. "
            "Start one with `safeloop daemon start`.",
            code="runtime_unavailable",
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SafeLoopRuntimeError(
            f"SafeLoop runtime connection file is unreadable: {exc}",
            code="runtime_unavailable",
        ) from exc


@dataclass
class ExecuteOutcome:
    """The result of proposing (and possibly executing) one action."""

    decision: dict[str, Any]
    proposal: dict[str, Any]
    result: dict[str, Any] | None = None

    @property
    def held(self) -> bool:
        """True when policy held this action for a human decision."""
        return bool(self.decision.get("requires_approval")) and self.result is None

    @property
    def executed(self) -> bool:
        return bool(self.result and self.result.get("status") == "EXECUTED")

    @property
    def disposition(self) -> str:
        return str(self.decision.get("disposition", ""))

    @property
    def approval_request_id(self) -> str | None:
        request = self.decision.get("approval_request")
        return request.get("approval_request_id") if isinstance(request, dict) else None

    @property
    def stdout(self) -> str:
        return str((self.result or {}).get("stdout") or "")

    @property
    def rejection_reason(self) -> str | None:
        return (self.result or {}).get("rejection_reason")


@dataclass
class SafeLoopRuntimeClient:
    """Connection to a local SafeLoop runtime daemon."""

    base_url: str
    credential: str
    timeout: float = 30.0

    def request(self, path: str, body: dict[str, Any] | None = None, method: str = "POST") -> dict[str, Any]:
        payload = json.dumps(body or {}).encode("utf-8") if method == "POST" else None
        req = urllib_request.Request(
            f"{self.base_url}{path}",
            data=payload,
            method=method,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.credential}",
            },
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(detail)
            except json.JSONDecodeError:
                parsed = {}
            raise SafeLoopRuntimeError(
                str(parsed.get("message") or detail or exc.reason),
                code=str(parsed.get("error") or "runtime_error"),
                status=exc.code,
            ) from exc
        except URLError as exc:
            # The runtime is unreachable. Callers must fail closed on this, not
            # fall back to acting ungoverned.
            raise SafeLoopRuntimeError(
                f"SafeLoop runtime is unreachable: {exc.reason}",
                code="runtime_unavailable",
            ) from exc
        return json.loads(raw) if raw else {}

    def health(self) -> dict[str, Any]:
        return self.request("/health", method="GET")

    def status(self) -> dict[str, Any]:
        return self.request("/v1/status", method="GET")

    def grant_approval(self, approval_request_id: str, approver: str, ttl_ms: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"approval_request_id": approval_request_id, "approver": approver}
        if ttl_ms is not None:
            body["ttl_ms"] = ttl_ms
        return self.request("/v1/approval/grant", body)

    def start_session(
        self,
        *,
        agent_id: str,
        tenant_id: str,
        agent_name: str | None = None,
        agent_type: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        workspace: str | None = None,
        profile: str | None = None,
        scenario_id: str | None = None,
        parent_session_id: str | None = None,
        parent_credential: str | None = None,
    ) -> "RuntimeSession":
        agent: dict[str, Any] = {"agent_id": agent_id}
        for key, value in (
            ("agent_name", agent_name),
            ("agent_type", agent_type),
            ("model", model),
            ("provider", provider),
        ):
            if value is not None:
                agent[key] = value

        body: dict[str, Any] = {"agent": agent, "tenant_id": tenant_id}
        for key, value in (
            ("workspace", str(Path(workspace).resolve()) if workspace else None),
            ("profile", profile),
            ("scenario_id", scenario_id),
            ("parent_session_id", parent_session_id),
            ("parent_credential", parent_credential),
        ):
            if value is not None:
                body[key] = value

        handle = self.request("/v1/session/start", body)
        return RuntimeSession(
            client=self,
            session=handle["session"],
            credential=handle["credential"],
            managed_paths=handle.get("managed_paths", []),
        )


@dataclass
class RuntimeSession:
    """A governed session. Identity is fixed by the runtime at session start."""

    client: SafeLoopRuntimeClient
    session: dict[str, Any]
    credential: str
    managed_paths: list[dict[str, Any]] = field(default_factory=list)

    @property
    def session_id(self) -> str:
        return str(self.session["session_id"])

    @property
    def agent_id(self) -> str:
        return str(self.session["agent"]["agent_id"])

    @property
    def tenant_id(self) -> str:
        return str(self.session["tenant_id"])

    def _auth(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        body = {"credential": self.credential, "session_id": self.session_id}
        body.update(extra or {})
        return body

    # --- Lifecycle -------------------------------------------------------

    def start_task(self, goal: str | None = None, task_id: str | None = None) -> str:
        body: dict[str, Any] = {}
        if goal is not None:
            body["goal"] = goal
        if task_id is not None:
            body["task_id"] = task_id
        return str(self.client.request("/v1/task/start", self._auth(body))["task_id"])

    def finish_task(self, task_id: str) -> None:
        self.client.request("/v1/task/finish", self._auth({"task_id": task_id}))

    def finish(self) -> None:
        self.client.request("/v1/session/finish", self._auth())

    # --- Actions ---------------------------------------------------------

    def propose(self, action: dict[str, Any], task_id: str) -> dict[str, Any]:
        return self.client.request(
            "/v1/action/propose",
            self._auth({"task_id": task_id, "action": {**action, "agent_id": self.agent_id}}),
        )

    def execute(self, action: dict[str, Any], task_id: str, timeout_ms: int | None = None) -> ExecuteOutcome:
        """Propose, then execute if the runtime authorized it.

        A held action is returned with ``held=True`` rather than raising, so an
        adapter can surface the hold to a human instead of failing the task.
        """
        proposal = {**action, "agent_id": self.agent_id}
        decision = self.propose(proposal, task_id)

        permit = decision.get("execution_permit")
        if not permit:
            return ExecuteOutcome(decision=decision, proposal=proposal)

        body = self._auth({"permit": permit, "action": proposal})
        if timeout_ms is not None:
            body["timeout_ms"] = timeout_ms
        result = self.client.request("/v1/action/execute", body)
        return ExecuteOutcome(decision=decision, proposal=proposal, result=result)

    def execute_approved(self, proposal: dict[str, Any], task_id: str, token: dict[str, Any]) -> dict[str, Any]:
        """Resume a held action with a granted approval token."""
        redemption = self.client.request(
            "/v1/approval/redeem",
            self._auth({"task_id": task_id, "token": token, "action": proposal}),
        )
        if not redemption.get("redeemed") or not redemption.get("execution_permit"):
            raise SafeLoopRuntimeError(
                str(redemption.get("reason") or "the approval token was not accepted"),
                code=str(redemption.get("failure") or "approval_rejected"),
                status=403,
            )
        return self.client.request(
            "/v1/action/execute",
            self._auth({"permit": redemption["execution_permit"], "action": proposal}),
        )

    # --- Convenience action builders -------------------------------------

    def execute_shell(self, argv: Sequence[str], task_id: str, cwd: str | None = None, timeout_ms: int | None = None) -> ExecuteOutcome:
        action: dict[str, Any] = {
            "action_kind": "shell",
            "operation": "exec",
            "tool": "shell",
            "arguments": {"argv": list(argv)},
        }
        if cwd:
            action["cwd"] = cwd
        return self.execute(action, task_id, timeout_ms)

    def read_file(self, path: str, task_id: str) -> ExecuteOutcome:
        return self.execute(
            {"action_kind": "filesystem", "operation": "read", "tool": "filesystem", "target": path, "arguments": {}},
            task_id,
        )

    def write_file(self, path: str, content: str, task_id: str, operation: str = "create") -> ExecuteOutcome:
        return self.execute(
            {
                "action_kind": "filesystem",
                "operation": operation,
                "tool": "filesystem",
                "target": path,
                "arguments": {"content": content},
            },
            task_id,
        )

    def git(self, operation: str, cwd: str, task_id: str, **arguments: Any) -> ExecuteOutcome:
        return self.execute(
            {
                "action_kind": "git",
                "operation": operation,
                "tool": "git",
                "cwd": cwd,
                "target": cwd,
                "arguments": arguments,
            },
            task_id,
        )

    # --- Memory ----------------------------------------------------------

    def propose_memory(self, candidate: dict[str, Any], task_id: str) -> dict[str, Any]:
        return self.client.request("/v1/memory/propose", self._auth({"task_id": task_id, "candidate": candidate}))

    def persist_memory(self, candidate: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
        return self.client.request(
            "/v1/memory/persist",
            self._auth({"candidate": candidate, "decision": decision, "permit": decision.get("persistence_permit")}),
        )

    def remember(self, candidate: dict[str, Any], task_id: str) -> dict[str, Any]:
        """Govern a candidate and activate it only if the runtime authorized it."""
        decision = self.propose_memory(candidate, task_id)
        return self.persist_memory(candidate, decision)

    def active_memories(self) -> list[dict[str, Any]]:
        return list(self.client.request("/v1/memory/active", self._auth()).get("memories", []))

    # --- Delegation ------------------------------------------------------

    def delegate(self, *, agent_id: str, agent_name: str | None = None) -> "RuntimeSession":
        """Start a sub-agent session that inherits this session's ceilings.

        The runtime rejects any attempt to change tenant, scenario, or profile,
        and caps the child's budgets at this session's remaining budget.
        """
        return self.client.start_session(
            agent_id=agent_id,
            agent_name=agent_name,
            tenant_id=self.tenant_id,
            workspace=self.session.get("workspace"),
            profile=self.session.get("profile"),
            parent_session_id=self.session_id,
            parent_credential=self.credential,
        )

    def __enter__(self) -> "RuntimeSession":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            self.finish()
        except SafeLoopRuntimeError:
            # A session that cannot be closed cleanly must not mask the real
            # exception the caller is already handling.
            pass
        return False


def connect(
    base_dir: str | os.PathLike[str] | None = None,
    *,
    base_url: str | None = None,
    credential: str | None = None,
    timeout: float = 30.0,
) -> SafeLoopRuntimeClient:
    """Connect to a running SafeLoop runtime, reading its connection file."""
    if base_url and credential:
        return SafeLoopRuntimeClient(base_url=base_url, credential=credential, timeout=timeout)
    connection = _read_connection(base_dir)
    return SafeLoopRuntimeClient(
        base_url=base_url or f"http://{connection['host']}:{connection['port']}",
        credential=credential or connection["credential"],
        timeout=timeout,
    )


@contextmanager
def session(
    *,
    agent_id: str,
    tenant_id: str,
    base_dir: str | os.PathLike[str] | None = None,
    base_url: str | None = None,
    credential: str | None = None,
    **kwargs: Any,
) -> Iterator[RuntimeSession]:
    """Open a governed session and close it on exit.

    ``with safeloop.session(agent_id=..., tenant_id=...) as s: ...``
    """
    client = connect(base_dir, base_url=base_url, credential=credential)
    runtime_session = client.start_session(agent_id=agent_id, tenant_id=tenant_id, **kwargs)
    try:
        yield runtime_session
    finally:
        try:
            runtime_session.finish()
        except SafeLoopRuntimeError:
            pass
