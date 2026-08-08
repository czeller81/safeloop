# SafeLoop v0.2 Runtime Governance Gap Analysis

Branch: `runtime-governance-v0.2`
Base commit: `e0c93ec` (docs-final-certification)
Analysis date: 2026-08-07

## Measured Starting Baseline

| Check | Command | Result |
| --- | --- | --- |
| Jest | `npx jest --runInBand` | 56 suites / 395 tests PASS |
| Python | `python3 -m pytest python/tests` | 13 passed |
| Build | `npm run build` | PASS |
| UI build | `npm run build:ui` | PASS |
| TypeScript | `npx tsc --noEmit` | PASS (0 errors) |
| Dependency audit | `npm audit --audit-level=moderate` | 0 vulnerabilities |
| MCP doctor | `npm run mcp:doctor:hermes` | 8/8 PASS |

## Component Classification

| # | Component | Current implementation | Class | v0.2 action |
| --- | --- | --- | --- | --- |
| 1 | Runtime protocol | `schemas/*.json` (11 schemas), TS interfaces in `src/runtimeGovernance.ts` | PARTIAL | Versioned `safeloop.runtime.v1` protocol namespace + schemas for action/permit/memory binding |
| 2 | Action model | Loose triple `action`/`target`/`argumentsHash` strings | REFACTOR_REQUIRED | Introduce structured `ActionProposal` / `CanonicalAction` |
| 3 | Action fingerprints | `computeFingerprint()` private to `approvalToken.ts`, string-concat over 8 loose fields | REFACTOR_REQUIRED | Deterministic canonicalizer + SHA-256 `fingerprintAction()` as first-class module |
| 4 | Approvals | `createApprovalGate()` — HMAC-signed, bound, single-use, revocable | EXISTS (strong) | Rebase binding onto action fingerprint; keep engine |
| 5 | Approval storage/redemption | `approvalStateStore.ts` — in-memory + JSON file | REFACTOR_REQUIRED | Read-modify-write file store is **not atomic**; concurrent redemption can double-spend. Replace with exclusive-create (`wx`) per-token record |
| 6 | Risk evaluation | `inferRiskDimensions()` — 16 dimensions, deterministic | EXISTS | Reuse unchanged |
| 7 | Policy engine | `evaluateRuntimePolicy()` + `policyConfig.ts` + `createPolicyGate()` | EXISTS | Reuse as the single policy authority; no second engine |
| 8 | Runtime state | None — every call is stateless | MISSING | Session/task registry owned by runtime |
| 9 | Daemon / server | `src/monitor/server.ts` (dashboard HTTP only) | PARTIAL | Dedicated governance daemon; monitor stays a dashboard |
| 10 | Transports | MCP stdio, CLI stdin, monitor HTTP | PARTIAL | Add unix socket + authenticated localhost HTTP |
| 11 | Shell execution | `commandGuard.ts` — evaluates then `spawnSync` in the same call | PARTIAL | Good primitive, but decision is not permit-bound; wrap in managed executor |
| 12 | Filesystem execution | None | MISSING | Managed FS executor with workspace-aware policy |
| 13 | Git execution | None (git is an opaque terminal string) | MISSING | First-class git action family |
| 14 | HTTP/network execution | None (risk heuristics only) | MISSING | Managed HTTP abstraction |
| 15 | MCP execution | `mcp/safeLoopMcpGateway.ts` exposes SafeLoop tools | PARTIAL | Tool availability ≠ governance; add downstream MCP governance |
| 16 | Memory governance | `verifyCandidateMemory()` + `memoryAdapter.ts`; poisoning fix at `527785c` | EXISTS | Preserve semantics exactly |
| 17 | Memory persistence authorization | None — adapter persists whatever it is handed | MISSING | **Memory TOCTOU**: candidate fingerprint + persistence permit |
| 18 | Identity | Fields carried per call, caller-supplied every time | PARTIAL | Runtime-established identity, non-substitutable after session start |
| 19 | Tenant isolation | Enforced inside approval fingerprint | PARTIAL | Extend to permits, memory, evidence |
| 20 | Delegation | `specialistGovernance.ts`, `handoffGovernance.ts` | PARTIAL | Add explicit ceiling inheritance + privilege-widening rejection |
| 21 | Budgets | Scenario contract fields + breaker thresholds | PARTIAL | Enforce at executor call sites, not just state objects |
| 22 | Circuit breakers | `createRuntimeCircuitBreaker()` — CLOSED/WARNING/OPEN/LOCKED | EXISTS | Wire into executor admission |
| 23 | Evidence | `evidenceRegistry.ts` | EXISTS | Emit execution results as evidence |
| 24 | Ledger | `eventStream.ts` + `ledgerIntegrity.ts` (seal/verify) | EXISTS | Reuse |
| 25 | TypeScript SDK | Library exports from `src/index.ts` (in-process only) | PARTIAL | Session-oriented runtime client |
| 26 | Python SDK | `python/safeloop_client/client.py` (thin CLI/HTTP shim) | PARTIAL | First-class session/execute/memory adapter |
| 27 | CLI | `src/cli.ts` — init/check/run/ledger/policy/appliance/audit/governance/mcp/monitor | PARTIAL | Add `daemon`, `status`, `certify`; upgrade `run`, `init` |
| 28 | Profiles | `policyConfig.ts` has profile-ish presets | PARTIAL | Data-driven governance profiles (coding/research/assistant/strict-local) |
| 29 | Control Tower | `src/monitor/*` full dashboard | EXISTS | Surface real runtime state |
| 30 | Conformance framework | None | MISSING | `safeloop certify` with machine-readable output |
| 31 | Hermes adapter | `plugins/safeloop_guard/__init__.py` (279 lines) | REFACTOR_REQUIRED | Replace `SAFELOOP_HERMES_APPROVED` env-var approved-context with bound token redemption |
| 32 | Managed path model | Implicit only | MISSING | MANAGED / UNMANAGED / DISABLED declarations |

## Root-Cause Gaps Driving v0.2

### G1 — Decision/execution decoupling (P0)
`evaluateRuntimePolicy()` returns a disposition; the caller then performs *some* action.
Nothing binds the returned ALLOW to the action that was evaluated.
`commandGuard.run()` is the only place where decision and side effect are coupled,
and even there the decision is not represented as a redeemable permit.

### G2 — Approved-context authorization (P0)
The Hermes adapter sets `context.hasHumanApproval = true` from the environment variable
`SAFELOOP_HERMES_APPROVED`. Any process able to set that variable converts every
REQUIRE_APPROVAL into ALLOW. This is the limitation recorded in the pilot certification
and it is the single largest correctness gap.

### G3 — Non-atomic approval consumption (P0)
`createLocalApprovalStateStore.writeRecord()` performs read → check → push → write.
Two concurrent redemptions can both observe "not consumed" and both succeed.

### G4 — Memory TOCTOU (P0)
`verifyCandidateMemory(A)` returns ALLOW. The adapter is then free to persist candidate B.
No fingerprint binds the decision to the governed bytes.

### G5 — No structured action families
Shell, filesystem, git, HTTP, and MCP all collapse into `action: string`, so policy
must pattern-match English text. Substring matching (`includesPattern`) cannot express
"git push to origin main from /repo".

### G6 — Per-action Node process
The Hermes adapter spawns `node dist/cli.js` for every governed tool call
(~150ms+ each). A resident runtime is required for acceptable latency.

## Implementation Order

A → B/C (protocol + canonical action) → D (bound approvals) → E/F/G (daemon, auth, executor core)
→ H/I/J (shell, fs, git) → K/L/M (memory binding) → N/O/P (adapter spec, SDKs)
→ Q/R/S (run, profiles, path model) → T/U (MCP, network) → V/W/X (breakers, identity, status)
→ Y (conformance) → Z (Hermes migration) → red team → docs/certification.

## Non-Goals Reaffirmed

SafeLoop governs actions routed through SafeLoop-managed execution paths. It is not a
kernel module, EDR, antivirus, firewall, IAM system, syscall interceptor, or OS sandbox.
Unmanaged host processes require external controls.
