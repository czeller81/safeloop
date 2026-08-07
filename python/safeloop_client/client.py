from __future__ import annotations

import json
import shlex
import subprocess
from dataclasses import dataclass
from typing import Any, Literal, Sequence
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError


Transport = Literal["http", "cli"]


class SafeLoopClientError(RuntimeError):
    """Raised when a SafeLoop transport call fails."""


@dataclass
class SafeLoopClient:
    """Thin client for the canonical SafeLoop governance engine.

    Use ``transport="http"`` when the local monitor server is running.
    Use ``transport="cli"`` when an agent can invoke the SafeLoop CLI.
    """

    base_url: str = "http://127.0.0.1:3777"
    transport: Transport = "http"
    cli: str | Sequence[str] = "safeloop"
    timeout: float = 10.0

    def evaluate_policy(self, payload: dict[str, Any], *, record: bool = False) -> dict[str, Any]:
        """Evaluate a governance policy request.

        The payload must follow ``schemas/policy-request.schema.json``.
        """

        if self.transport == "http":
            body = {"input": payload, "record": record}
            return self._post_json("/api/governance/evaluate", body)

        args = [*self._cli_args(), "governance", "evaluate", "--stdin"]
        if record:
            args.append("--record")
        return self._run_cli(args, payload)

    def verify_memory(self, memory: dict[str, Any], *, scenario: dict[str, Any] | None = None, minimum_confidence: float | None = None) -> dict[str, Any]:
        """Verify a candidate durable memory before writing it.

        The memory payload must follow ``schemas/memory-candidate.schema.json``.
        """

        payload: dict[str, Any] = {"memory": memory}
        if scenario is not None:
            payload["scenario"] = scenario
        if minimum_confidence is not None:
            payload["minimumConfidence"] = minimum_confidence

        if self.transport == "http":
            return self._post_json("/api/governance/memory", payload)

        return self._run_cli([*self._cli_args(), "governance", "memory", "--stdin"], payload)

    def _cli_args(self) -> list[str]:
        if isinstance(self.cli, str):
            return shlex.split(self.cli)
        return list(self.cli)

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = self.base_url.rstrip("/") + path
        data = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=data,
            method="POST",
            headers={"content-type": "application/json", "accept": "application/json"},
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise SafeLoopClientError(f"SafeLoop HTTP {exc.code}: {body}") from exc
        except URLError as exc:
            raise SafeLoopClientError(f"SafeLoop HTTP connection failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise SafeLoopClientError(f"SafeLoop returned invalid JSON: {exc}") from exc

    def _run_cli(self, args: list[str], payload: dict[str, Any]) -> dict[str, Any]:
        try:
            completed = subprocess.run(
                args,
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                timeout=self.timeout,
                check=False,
            )
        except OSError as exc:
            raise SafeLoopClientError(f"SafeLoop CLI failed to start: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise SafeLoopClientError("SafeLoop CLI timed out") from exc

        if not completed.stdout.strip():
            raise SafeLoopClientError(f"SafeLoop CLI returned no JSON. stderr={completed.stderr.strip()}")

        try:
            parsed = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise SafeLoopClientError(f"SafeLoop CLI returned invalid JSON: {completed.stdout}") from exc

        if completed.returncode not in (0, 10, 20):
            raise SafeLoopClientError(f"SafeLoop CLI failed with {completed.returncode}: {completed.stderr.strip()}")

        return parsed
