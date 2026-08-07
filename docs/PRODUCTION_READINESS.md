# SafeLoop Production Readiness

> Certification Date: 2026-08-07
> Version: 0.1.0
> Repository: czeller81/safeloop
> Auditor: Codex independent post-merge certification

## Verdict: `READY`

SafeLoop is a credible local-first runtime governance layer for AI agents when agents, MCP hosts, connectors, and tool wrappers route consequential actions through SafeLoop.

It is ready inside that documented routed-action boundary for controlled local pilots and appliance-style deployments where the operator controls the tool surface, credentials, filesystem access, and network egress.

It is not yet ready to be described as a universal production containment system, a hosted multi-tenant control plane, or an OS-level sandbox.

## Independent Verification

```
Branch:       master
Latest commit: 94aaf6a feat: production readiness hardening — close all governance gaps (#9)
Install:      npm ci passed
Build:        npm run build passed
Typecheck:    npx tsc --noEmit passed
Lint:         no dedicated lint script configured
Tests:        56 suites / 394 tests passed
Python:       13 tests passed
Security:     npm audit reports 0 vulnerabilities after Vite/esbuild remediation
```

## What Is Verified

### Pre-Execution Command Enforcement

```
Agent proposes command
-> CommandGuard evaluates policy
-> DENY or REQUIRE_APPROVAL
-> command is not passed to spawnSync
-> ledger event is recorded
```

Source evidence:

- `src/commandGuard.ts`: denied and approval-required branches return before `spawnSync`.
- `tests/commandGuard.test.ts`, `tests/mcpGateway.test.ts`, `tests/mcpStdioServer.test.ts`, and `tests/governanceLifecycle.integration.test.ts`: denied/held commands return `executed: false`.

### Approval Token Hardening

`createApprovalGate()` provides HMAC-signed approval tokens bound to:

- action
- target
- arguments hash
- task
- session
- tenant
- agent
- environment
- expiry

It also supports single-use redemption and revocation within the current process instance.

Verified adversarial cases:

- forged signature
- expired token
- reused token
- revoked token
- different action
- different target
- different arguments
- different tenant
- different task
- different session
- different agent
- different environment

Known limitation: approval tokens are in-memory by default. Use `createLocalApprovalStateStore()` for restart-safe consumed/revoked token state. `CommandGuard` can redeem context-bound approval tokens during guarded execution when configured with an approval gate.

### Fail-Closed Behavior

`createGovernedPolicyEngine()` fails closed for high-risk actions when policy evaluation throws or returns malformed/null data. Low-risk/read-only fail-open behavior exists, but must match configured low-risk patterns or explicit fail-open configuration.

`createGovernedPolicyEngine().evaluateAsync()` enforces `timeoutMs`. Invalid timeout values fall back to the default timeout rather than disabling timeout handling.

### Evidence And Provenance

SafeLoop distinguishes:

- `VERIFIED_FACT`
- `OBSERVATION`
- `INFERENCE`
- `ASSUMPTION`
- `SPECULATION`
- `UNVERIFIED`

`promoteEvidence()` prevents `INFERENCE`, `ASSUMPTION`, `SPECULATION`, and `UNVERIFIED` from jumping directly to `VERIFIED_FACT`. `OBSERVATION -> VERIFIED_FACT` requires an artifact hash, and provided artifact content must match the hash.

Known limitation: external verification provider integration and cryptographic artifact signing remain deployment or adapter work.

### Memory Governance

`verifyCandidateMemory()` gates durable memory candidates before a memory system persists them. It can allow, allow with TTL, require review, quarantine, or reject memory candidates based on confidence, evidence, sensitive-data flags, generalization, and scenario memory policy.

Known limitation: SafeLoop does not own the durable memory store. Hermes, Malu-style memory sidecars, vector stores, memory graphs, AGENTS.md systems, and custom memory frameworks must call SafeLoop before persistence.

### Ledger Integrity

`sealLedger()` and `verifyLedger()` provide SHA-256 hash-chain sealing for valid JSONL event lines. Post-seal edits or appended events are detected.

Use the phrase **tamper-evident ledger**. Do not describe the local JSONL file as immutable.

## Security Audit Result

`npm audit --audit-level=moderate` currently reports 0 vulnerabilities after dependency remediation. The remediation upgraded Vite to the current major line, and the Vite config was moved to an `.mts` module file to avoid the prior CommonJS/ESM config warning.

## Current Readiness

| Deployment Type | Recommendation |
| --- | --- |
| Local development | Suitable |
| Controlled school-district/local appliance pilot | Suitable inside the routed-action boundary with external platform controls |
| Broader production deployment | Requires stronger identity/tenant controls, remote deployment hardening, and operational runbooks outside SafeLoop |

## Required Controls For School District Pilots

- Route Hermes, MCP, ingestion, RAG, file, and shell tools through SafeLoop.
- Do not expose unmanaged raw shell or external network tools to agents expected to be governed.
- Use OS/network controls for offline mode and egress restriction.
- Store `.safeloop` ledgers on protected local storage.
- Seal ledgers before formal review.
- Define district approval roles and retention rules.
- Treat SafeLoop as cooperative governance, not standalone compliance.

## Remaining Limitations

- Approval tokens are in-memory by default unless `createLocalApprovalStateStore()` is configured.
- Python client has a native pytest suite; install `python/requirements-dev.txt` before running it locally.
- HTTP governance endpoints are local-first by default; secured mode supports bearer auth, tenant allowlists, and a rate-limit hook.
- No OpenTelemetry export.
- No OS sandbox, kernel-level filesystem control, or network firewalling.
- Circuit breaker state must be honored by adapters to stop non-command effects.
- Durable memory systems must integrate with `verifyCandidateMemory()`.
