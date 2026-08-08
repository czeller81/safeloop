#!/usr/bin/env python3
"""Live proof that the dashboard reports the lazy-install control truthfully.

Two runs, both against a real SafeLoop runtime with a *hostile* parent
environment (`HERMES_LAZY_INSTALL_TARGET` set to a durable target, the case
where Hermes would otherwise redirect installs rather than block them):

  POSITIVE  the real adapter seals and reports  → dashboard shows DISABLED
  NEGATIVE  verification is simulated as failed → dashboard shows
            VERIFICATION_FAILED and a blocked session, never green

Nothing is installed. Everything happens under /tmp.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CLI = REPO_ROOT / "dist" / "cli.js"
HERMES = Path("/home/charleszeller/.hermes/hermes-agent")

sys.path.insert(0, str(REPO_ROOT / "python"))
sys.path.insert(0, str(HERMES))

RESULTS: list[dict[str, object]] = []


def record(name: str, expected: str, actual: str, ok: bool) -> None:
    RESULTS.append({"test": name, "expected": expected, "actual": actual,
                    "result": "PASS" if ok else "FAIL"})
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    if not ok:
        print(f"         expected: {expected}")
        print(f"         actual:   {actual}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_daemon(state: Path, workspace: Path):
    port = free_port()
    proc = subprocess.Popen(
        ["node", str(CLI), "daemon", "start", "--foreground", "--port", str(port),
         "--profile", "coding", "--workspace", str(workspace), "--baseDir", str(state)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, cwd=str(REPO_ROOT),
    )
    connection_file = state / ".safeloop" / "runtime" / "runtime-credential.json"
    deadline = time.time() + 20
    while time.time() < deadline and not connection_file.exists():
        if proc.poll() is not None:
            raise SystemExit("daemon exited early: " + (proc.stderr.read() or b"").decode())
        time.sleep(0.05)
    return proc, json.loads(connection_file.read_text())


def dashboard_controls(state: Path) -> list[dict]:
    """Read the control status exactly as the dashboard derives it."""
    out = subprocess.run(
        ["node", "-e", f"""
        const {{ getDashboardSnapshot }} = require({json.dumps(str(REPO_ROOT / 'dist' / 'monitor' / 'dashboardData.js'))});
        const snap = getDashboardSnapshot({{ baseDir: {json.dumps(str(state))} }});
        process.stdout.write(JSON.stringify(snap.runtimeControls));
        """],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    if out.returncode != 0:
        raise SystemExit("dashboard read failed: " + out.stderr)
    return json.loads(out.stdout or "[]")


def main() -> int:
    if not CLI.exists():
        print("dist/cli.js is missing; run `npm run build` first.")
        return 1

    from safeloop_client.runtime import SafeLoopRuntimeClient

    # ---------- POSITIVE ----------
    work = Path(tempfile.mkdtemp(prefix="safeloop-v02-dash-pos-"))
    state, workspace = work / "state", work / "ws"
    state.mkdir(); workspace.mkdir()
    hostile_target = work / "durable-target"
    hostile_target.mkdir()

    daemon, conn = start_daemon(state, workspace)
    print("\nDashboard control proof — POSITIVE (hostile parent target set)")
    print(f"  HERMES_LAZY_INSTALL_TARGET = {hostile_target}\n")

    client = SafeLoopRuntimeClient(base_url=f"http://{conn['host']}:{conn['port']}",
                                   credential=conn["credential"])
    session = client.start_session(agent_id="hermes", agent_name="Hermes",
                                   tenant_id="dash-proof", workspace=str(workspace), profile="coding")

    os.environ.update({
        "SAFELOOP_HERMES_GUARD": "1",
        "SAFELOOP_RUNTIME_URL": f"http://{conn['host']}:{conn['port']}",
        "SAFELOOP_RUNTIME_CREDENTIAL": conn["credential"],
        "SAFELOOP_SESSION_ID": session.session_id,
        "SAFELOOP_SESSION_CREDENTIAL": session.credential,
        "SAFELOOP_PYTHON_SDK": str(REPO_ROOT / "python"),
        "HERMES_LAZY_INSTALL_TARGET": str(hostile_target),
    })

    from tools import lazy_deps
    from plugins.safeloop_guard import register as hermes_register

    gate_before = lazy_deps._allow_lazy_installs()

    class Ctx:
        def register_middleware(self, *_a, **_k) -> None:
            return None

    hermes_register(Ctx())  # real adapter: seals, verifies, reports
    gate_after = lazy_deps._allow_lazy_installs()

    record("hostile parent target does not keep installs enabled",
           "gate True -> False", f"{gate_before} -> {gate_after}",
           gate_before is True and gate_after is False)

    controls = dashboard_controls(state)
    control = next((c for c in controls if c["controlId"] == "dependency_installation"), None)

    record("dashboard shows DISABLED", "DISABLED",
           str(control and control["state"]), bool(control) and control["state"] == "DISABLED")
    record("dashboard shows runtime verification PASSED", "verified and passed",
           f"verified={control and control['verified']}, passed={control and control.get('verificationPassed')}",
           bool(control) and control["verified"] is True and control["verificationPassed"] is True)
    record("dashboard shows the durable target as unset by policy", "effect=unset",
           str([p for p in (control or {}).get("policy", []) if p["name"] == "HERMES_LAZY_INSTALL_TARGET"]),
           any(p["name"] == "HERMES_LAZY_INSTALL_TARGET" and p["effect"] == "unset"
               for p in (control or {}).get("policy", [])))
    record("dashboard never prints the durable target value", "value absent",
           "absent" if str(hostile_target) not in json.dumps(controls) else "LEAKED",
           str(hostile_target) not in json.dumps(controls))
    record("dashboard states the governance boundary", "scope names governed sessions",
           str((control or {}).get("boundary", ""))[:60],
           "launched through SafeLoop" in (control or {}).get("boundary", ""))
    record("session is not blocked", "no blocked flag",
           str(control and control["blocked"]), bool(control) and control["blocked"] is False)

    # The audit trail must record the refused dependency request.
    missing = [f for f in lazy_deps.LAZY_DEPS if lazy_deps.feature_missing(f)]
    refused = False
    detail = "no missing-package feature to probe"
    if missing:
        try:
            lazy_deps.ensure(missing[0], prompt=False)
            detail = "ensure() did not block"
        except lazy_deps.FeatureUnavailable as exc:
            refused = "lazy installs disabled" in str(exc)
            detail = f"FeatureUnavailable: {str(exc)[:50]}"
    record("real dependency request refused, nothing installed",
           "FeatureUnavailable: lazy installs disabled", detail, refused)

    daemon.terminate()
    try:
        daemon.wait(timeout=10)
    except subprocess.TimeoutExpired:
        daemon.kill()
    shutil.rmtree(work, ignore_errors=True)

    # ---------- NEGATIVE ----------
    print("\nDashboard control proof — NEGATIVE (verification simulated as failed)\n")
    work2 = Path(tempfile.mkdtemp(prefix="safeloop-v02-dash-neg-"))
    state2, workspace2 = work2 / "state", work2 / "ws"
    state2.mkdir(); workspace2.mkdir()
    daemon2, conn2 = start_daemon(state2, workspace2)

    client2 = SafeLoopRuntimeClient(base_url=f"http://{conn2['host']}:{conn2['port']}",
                                    credential=conn2["credential"])
    session2 = client2.start_session(agent_id="hermes", tenant_id="dash-proof",
                                     workspace=str(workspace2), profile="coding")

    # Simulate the adapter reporting a failed seal, which is what it does
    # immediately before raising LazyInstallStillEnabled.
    session2.report_control_verification(
        "dependency_installation", False,
        verified_by="hermes.safeloop_guard",
        detail="LazyInstallStillEnabled: gate could not be confirmed disabled",
    )

    controls2 = dashboard_controls(state2)
    control2 = next((c for c in controls2 if c["controlId"] == "dependency_installation"), None)

    record("dashboard shows VERIFICATION_FAILED", "VERIFICATION_FAILED",
           str(control2 and control2["state"]),
           bool(control2) and control2["state"] == "VERIFICATION_FAILED")
    record("dashboard marks the session blocked", "blocked=True",
           str(control2 and control2["blocked"]), bool(control2) and control2["blocked"] is True)
    record("dashboard never shows DISABLED when verification failed", "no DISABLED state",
           str([c["state"] for c in controls2]),
           all(c["state"] != "DISABLED" for c in controls2))

    status = client2.status()
    entry = next((s for s in status["sessions"] if s["session_id"] == session2.session_id), None)
    record("runtime status reports a blocked reason", "blocked_reason present",
           str((entry or {}).get("blocked_reason"))[:60],
           bool((entry or {}).get("blocked_reason")))

    daemon2.terminate()
    try:
        daemon2.wait(timeout=10)
    except subprocess.TimeoutExpired:
        daemon2.kill()
    shutil.rmtree(work2, ignore_errors=True)

    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    print(f"\n  {passed}/{len(RESULTS)} dashboard control checks passed\n")

    report = REPO_ROOT / "docs" / "evidence" / "dashboard-control-proof.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "control": "dependency_installation",
        "adversarial_condition": "durable install target present in parent environment",
        "passed": passed, "total": len(RESULTS), "checks": RESULTS,
    }, indent=2) + "\n")
    print(f"  Evidence written to {report}")

    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
