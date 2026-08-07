# SafeLoop Current State

Last audited on this branch: 2026-08-07.

## Repository State

- Current checkout during audit: `master`
- HEAD during audit: `94aaf6a`
- Latest branch work includes malformed JSONL tolerance, trace-first monitor UI, MCP stdio server support, specialist governance, effect guard coverage, runtime governance APIs, canonical JSON Schemas, authenticated HTTP governance endpoints, CLI/stdin JSON governance commands, local approval replay state, evidence registry, governed memory adapter, and a lightweight Python client.
- Package version: `0.1.0`
- Package manager: npm
- Build system: TypeScript compiler plus Vite for the local monitor UI
- Website source in this repository: none found beyond the local monitor UI served by SafeLoop

The prompt named `feature/dashboard-v1`, but the actual local checkout was `master` at audit time.

## Product Definition

SafeLoop is a local-first, open-source agent governance and accountability layer. It puts deterministic identity, authorization, approvals, risk controls, audit trails, evidence, and execution boundaries around AI agents.

Core principle:

> Maximum useful intelligence inside minimum necessary authority.

SafeLoop is agent-agnostic. Codex, Claude Code, Hermes, OpenCode, Replit Agents, custom scripts, and MCP hosts are actors that can route work through SafeLoop. SafeLoop governs the execution boundary when those actors cooperate with its guard, gateway, loop, or adapter APIs.

## Implemented Capabilities

Status labels:

- IMPLEMENTED: code and tests exist in this repository.
- DEMO: sample proof exists, but not a full product integration.
- EXPERIMENTAL: usable surface exists but should be treated as early.
- PLANNED: documented direction without implementation in this branch.

| Area | Status | Notes |
|------|--------|-------|
| Local event ledger | IMPLEMENTED | `.safeloop/events.jsonl` JSONL event stream with malformed-line tolerance. |
| Ledger integrity seal | IMPLEMENTED | `safeloop ledger seal` and `safeloop ledger verify` use a sidecar SHA-256 hash-chain seal without changing event schema. |
| Case files | IMPLEMENTED | Context, decisions, risks, approvals, artifacts, handoffs, participants, and reports. |
| Command guard | IMPLEMENTED | Policy-gated shell execution using `spawnSync`; blocked and approval-required commands do not execute. |
| Scenario loop | IMPLEMENTED | Scenario contract, step decisions, command guard integration, stop/block/escalate/success outcomes. |
| MCP gateway | IMPLEMENTED | `safeloop.checkCommand`, `safeloop.runCommand`, `safeloop.recordActivity`, `safeloop.status`. |
| MCP stdio server | IMPLEMENTED | JSON-RPC stdio transport; stdout remains protocol-only. `safeloop mcp serve` starts it from the main CLI. |
| Language-neutral protocol | IMPLEMENTED | Canonical JSON Schemas, local HTTP endpoints, CLI/stdin JSON, MCP, TypeScript exports, and Python client exist. Future Rust/Go/Java/.NET clients should wrap these surfaces. |
| Runtime policy engine | IMPLEMENTED | `evaluateRuntimePolicy()` returns allow, warning, approval, pause, deny, or stop decisions without changing the existing ledger schema. `createGovernedPolicyEngine().evaluateAsync()` enforces timeout behavior. |
| Runtime circuit breaker | IMPLEMENTED | Detects repeated tool calls, denied actions, failures, cost/token thresholds, and critical fail-closed risks for routed loops and adapters that honor returned state. |
| Memory governance | IMPLEMENTED | `verifyCandidateMemory()` governs candidate memory writes. `createGovernedMemoryAdapter()` provides a reference persistence pattern. Durable memory stores must integrate with it. |
| MCP diagnostics | IMPLEMENTED | `safeloop mcp doctor`, Hermes config output, and MCPorter troubleshooting commands. |
| Specialist routing | IMPLEMENTED | Deterministic routing by objective and delegated support hints. |
| Specialist permissions | IMPLEMENTED | Tool checks and context-aware action evaluation. |
| Delegated specialist authorization | IMPLEMENTED | Authorization token is bound to specialist/action context fingerprint. |
| Specialist review | IMPLEMENTED | Minimal and extended review payload validation with audit events. |
| Effect guard | IMPLEMENTED | Registered/expected adapters, coverage diagnostics, fail-closed behavior for expected missing production-impacting adapters. |
| Connectors | EXPERIMENTAL | Generic CLI connector and Hermes detection/status foundation. MCPorter remains a useful diagnostic bridge for Hermes setup. |
| Codex integration | DEMO | Local `examples/codex-governed-workflow-demo.ts`; no fake OpenAI API integration. |
| Local dashboard | IMPLEMENTED | Trace-first monitor at `http://127.0.0.1:3777`; `/api/dashboard` compatibility preserved. |
| Token/cost visibility | IMPLEMENTED | Explicit `token.cost`/`model.usage` events and cost summaries. |
| Timecard visibility | IMPLEMENTED | Monitor-derived timecard candidates and export endpoint. |
| Identity | IMPLEMENTED | Agent, participant, case, session, and task identifiers are carried through events. |
| Handoff | IMPLEMENTED | Case handoffs, manifests, hydration, monitor visibility, and handoff authorization checks that reject privilege widening or unresolved high-risk transfers. |
| Cancellation/emergency stop | PARTIAL | `createBreaker().trip()` provides a cooperative kill switch for breaker-managed work. No universal process kill or OS-level emergency stop exists. |
| Replay protection | PARTIAL | Approval and specialist authorization tokens are context-fingerprint bound and single-use. Approval consumed/revoked token IDs can persist through `createLocalApprovalStateStore()`. Ledger seals detect post-seal changes, but there is no global durable nonce store. |
| Tenant/project isolation | PARTIAL | Local `baseDir`, case IDs, project fields, and ledger paths separate data by convention. There is no multi-tenant auth boundary. |
| Telemetry/tracing | IMPLEMENTED | Local explicit event traces. No external telemetry pipeline. |
| CLI | IMPLEMENTED | `safeloop` bin plus example command wrapper and monitor commands. |
| Public hosted website | ABSENT | No standalone website source or deployment config was found in this repository. |
| School district offline RAG guidance | IMPLEMENTED | Local appliance architecture and K-12 compliance/security matrix are documented. `safeloop init --profile k12-offline-rag`, `safeloop policy compile`, `safeloop policy doctor`, `safeloop appliance doctor`, `safeloop audit export`, and `npm run demo:k12-local-rag` support local policy setup and review. SafeLoop is not a standalone compliance product. |

## Public API Surface

Primary exports are in `src/index.ts` and include:

- `createBreaker`, `createCodingAgentBreaker`, `createPolicyGate`, `createAgentRunLedger`
- Case file APIs: `createCaseFile`, `recordCaseDecision`, `recordCaseRisk`, `requestCaseApproval`, `resolveCaseApproval`, `attachArtifact`, `recordHandoff`, participant helpers
- Agent adapter APIs: `createAgentSession`, `processAgentEvent`
- Event APIs: `appendEvent`, `readEvents`, `readEventsWithDiagnostics`, `streamEvents`
- Governance APIs: `createCommandGuard`, `createScenarioLoop`
- MCP APIs: `createMcpGateway`
- Specialist APIs: `routeSpecialistTask`, `validateSpecialistTool`, `evaluateSpecialistAction`, `delegateSpecialistStep`, `reviewSpecialistResult`, `createEffectGuard`
- Cost/readiness APIs: `recordModelUsage`, `recordTokenCost`, `readModelUsage`, `readTokenCosts`, `setModelPricing`, `calculateCost`, `getCaseCostSummary`, `detectGoalDrift`, `calculateReadinessScore`
- Monitor APIs: `getDashboardSnapshot`, `createMonitorServer`, `startMonitorServer`, `buildMonitorDashboardPayload`, `buildMonitorViewModel`

## Monitor and Dashboard

Start the monitor:

```bash
npm run monitor
```

Open:

```text
http://127.0.0.1:3777
```

Dogfood ledger:

```bash
npm run dogfood:handoff
npm run monitor:dogfood
```

The monitor serves:

- `GET /api/dashboard`
- `GET /api/timecards/export`
- `GET /health`

`/api/dashboard` remains the compatibility endpoint. The current dashboard is trace-first and uses the enriched view model for live activity, governance strip, decision inspector, operational diagnostics, timecards, costs, approvals, risks, artifacts, handoffs, readiness, and oversight.

Additional local HTTP endpoints now support language-neutral governance:

- `POST /api/governance/evaluate`
- `POST /api/governance/memory`

These endpoints are additive and do not change `/api/dashboard`.

For secured local deployments, the governance endpoints can require a bearer token, enforce an allowed tenant list, and call a rate-limit hook. Local development mode remains open by default on `127.0.0.1`.

## Verification

Current independent verification on this branch after the PR #9 merge:

- `npm.cmd test -- --runInBand`: 56 suites / 394 tests passing
- `.venv\Scripts\python.exe -m pytest python\tests`: 13 tests passing
- `npm.cmd run build`: passing
- `npx.cmd tsc --noEmit`: passing
- `npm.cmd run build:ui`: passing
- `npm.cmd audit --audit-level=moderate`: 0 vulnerabilities

The first sandboxed Vite attempt failed with a parent-directory access restriction during earlier monitor work. The final local build gate passes. The test count is a current branch signal, not a permanent guarantee.

No lint script is currently configured in `package.json`.

## Known Gaps

P0:

- No P0 release blocker found in the audited local tests/builds.

P1:

- No OS-level sandboxing, credential isolation, network egress control, or universal process interception.
- Agent/tool paths that bypass SafeLoop bypass SafeLoop governance.
- FERPA, COPPA, CIPA, and district security requirements require deployment controls outside SafeLoop.
- Public website source is absent from this repository, so website synchronization cannot be completed locally.

P2:

- Connector coverage is early and should be expanded with explicit adapter install/verification workflows.
- Specialist authorization and approval replay protection are local-first; deployments that need cross-machine replay guarantees should use a shared state backend or external identity controls.
- Tenant/project isolation is local-path and metadata based, not an authenticated multi-tenant model.
- Scenario loop approval resume is not implemented.

P3:

- Changelog history should be normalized before a public release.
- Larger ledgers will eventually need pagination/windowing.
- Additional examples for non-Codex agents would improve adoption.
