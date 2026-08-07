from __future__ import annotations

import json
import subprocess
from urllib.error import HTTPError, URLError

import pytest

from safeloop_client.client import SafeLoopClient, SafeLoopClientError


class FakeResponse:
    def __init__(self, payload: str):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self.payload.encode("utf-8")


def test_policy_request_serialization(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse('{"disposition":"ALLOW"}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = SafeLoopClient(base_url="http://127.0.0.1:3777", timeout=3)
    result = client.evaluate_policy({"agentId": "agent-1", "action": "read status"}, record=True)

    assert result["disposition"] == "ALLOW"
    assert captured["url"].endswith("/api/governance/evaluate")
    assert captured["body"]["record"] is True
    assert captured["body"]["input"]["action"] == "read status"
    assert captured["timeout"] == 3


def test_memory_candidate_request(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse('{"decision":"ALLOW","allowed":true}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = SafeLoopClient()
    result = client.verify_memory({"memory_id": "mem-1", "situation": "done", "lesson": "retry"}, minimum_confidence=0.8)

    assert result["allowed"] is True
    assert captured["body"]["memory"]["memory_id"] == "mem-1"
    assert captured["body"]["minimumConfidence"] == 0.8


def test_authentication_header(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["authorization"] = req.headers.get("Authorization")
        return FakeResponse('{"disposition":"ALLOW"}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    SafeLoopClient(bearer_token="secret").evaluate_policy({"agentId": "a", "action": "read"})

    assert captured["authorization"] == "Bearer secret"


def test_http_error(monkeypatch):
    def fake_urlopen(req, timeout):
        raise HTTPError(req.full_url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(SafeLoopClientError, match="SafeLoop HTTP 401"):
        SafeLoopClient().evaluate_policy({"agentId": "a", "action": "read"})


def test_connection_error(monkeypatch):
    def fake_urlopen(req, timeout):
        raise URLError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(SafeLoopClientError, match="connection failed"):
        SafeLoopClient().evaluate_policy({"agentId": "a", "action": "read"})


def test_http_timeout(monkeypatch):
    def fake_urlopen(req, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(SafeLoopClientError, match="timed out"):
        SafeLoopClient(timeout=0.01).evaluate_policy({"agentId": "a", "action": "read"})


def test_malformed_response(monkeypatch):
    def fake_urlopen(req, timeout):
        return FakeResponse("not-json")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    with pytest.raises(SafeLoopClientError, match="invalid JSON"):
        SafeLoopClient().evaluate_policy({"agentId": "a", "action": "read"})


def test_cli_response_parsing(monkeypatch):
    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args=args[0], returncode=0, stdout='{"allowed":true}', stderr="")

    monkeypatch.setattr("subprocess.run", fake_run)
    result = SafeLoopClient(transport="cli", cli=["safeloop"]).evaluate_policy({"agentId": "a", "action": "read"})
    assert result["allowed"] is True


def test_cli_timeout(monkeypatch):
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=1)

    monkeypatch.setattr("subprocess.run", fake_run)
    with pytest.raises(SafeLoopClientError, match="timed out"):
        SafeLoopClient(transport="cli", cli=["safeloop"], timeout=1).evaluate_policy({"agentId": "a", "action": "read"})


def test_deny_response_parsing(monkeypatch):
    def fake_urlopen(req, timeout):
        return FakeResponse('{"disposition":"DENY","allowed":false}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = SafeLoopClient().evaluate_policy({"agentId": "a", "action": "delete production"})
    assert result["disposition"] == "DENY"
    assert result["allowed"] is False


def test_require_approval_response_parsing(monkeypatch):
    def fake_urlopen(req, timeout):
        return FakeResponse('{"disposition":"REQUIRE_APPROVAL","requiresApproval":true}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = SafeLoopClient().evaluate_policy({"agentId": "a", "action": "deploy"})
    assert result["disposition"] == "REQUIRE_APPROVAL"
    assert result["requiresApproval"] is True


def test_quarantine_memory_response_parsing(monkeypatch):
    def fake_urlopen(req, timeout):
        return FakeResponse('{"decision":"QUARANTINE","allowed":false}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = SafeLoopClient().verify_memory({"memory_id": "m", "situation": "s", "lesson": "l"})
    assert result["decision"] == "QUARANTINE"
    assert result["allowed"] is False


def test_reject_memory_response_parsing(monkeypatch):
    def fake_urlopen(req, timeout):
        return FakeResponse('{"decision":"REJECT","allowed":false}')

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = SafeLoopClient().verify_memory({"memory_id": "m", "situation": "", "lesson": ""})
    assert result["decision"] == "REJECT"
    assert result["allowed"] is False
