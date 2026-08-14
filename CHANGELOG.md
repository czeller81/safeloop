# Changelog

All notable changes to this project will be documented in this file.

## 0.2.1 - 2026-08-14

This source/GitHub patch release contains work that landed after the immutable
`v0.2.0` tag. Do not read these fixes back into the original `v0.2.0` release,
which remains tagged at `01d73bec3500901a1c1e203fb532f0511c9958a4`.

### Added

- Added the causal work-graph foundation for reconstructing governed agent
  sessions. The schema-versioned session/work graph links proposals,
  governance decisions, approval requests, approval redemption, permit issuance,
  execution, evidence, verification, and memory linkage where available. Session
  inspection via CLI and bounded timeline/session inspection APIs now expose
  real causal IDs while preserving compatibility with legacy sessions.
- Added structured execution proof records for managed filesystem, Git, shell,
  HTTP, and downstream MCP executor paths. Proof records distinguish what was
  authorized, what executed, what SafeLoop directly observed, and what remains
  outside proof scope.
- Added explicit execution verification statuses: `VERIFIED`,
  `PARTIALLY_VERIFIED`, `NOT_VERIFIABLE`, and `FAILED`.

### Fixed

- Made filesystem proof semantics truthful after independent review. Confirmed
  absence is now distinct from inability to observe; permission and observation
  failures are not treated as absence; files above the evidence hashing cap are
  marked `PARTIALLY_VERIFIED`; SafeLoop no longer claims a complete content hash
  when one was not computed; verified delete requires confirmed post-state
  absence; and move source/destination proof is evaluated independently.
- Fixed risk-escalated approval redemption by recomputing the effective
  governance disposition from both profile rules and runtime risk during
  redemption. Risk-held HTTP reads, in-workspace destructive filesystem actions,
  and production-target writes now grant, redeem, issue permits, and execute
  only through valid one-time permits while preserving action, fingerprint,
  identity, tenant, session, and execution-context binding. The remediation does
  not introduce an authorization bypass.
- Hardened the permit fingerprint regression so proposal-state drift fails at
  the proposal stage instead of surfacing later as a misleading missing-permit
  rejection.
- Resolved `GHSA-2v37-7h3g-55p8` by updating transitive `nanoid` from
  `3.3.17` to `3.3.18` in `package-lock.json` via `npm audit fix` without a
  `package.json` dependency change. `npm audit --audit-level=moderate` returned
  0 vulnerabilities during release preparation.

### Documentation

- Modernized the README around SafeLoop's v0.2 runtime-governance positioning
  and routed-action boundary.
- Added a source-controlled v2 architecture diagram for governed actions,
  memory persistence, execution path inventory, evidence, and dashboard
  observation, then replaced obsolete generated architecture graph assets with
  the approved GitHub-ready image.
- Added a docs index that classifies current docs, developer references, user
  guides, historical records, and audit evidence.
- Added `docs/audits/APPROVAL_STATE_REMEDIATION_DESIGN.md` and
  `docs/audits/GITHUB_ISSUE_RECONCILIATION_2026-08.md` to record the approval
  remediation design and public issue reconciliation evidence.
- Updated approval, managed execution, security, architecture, and roadmap
  documentation to match post-`v0.2.0` behavior while keeping Same-UID,
  userspace timing, external memory, dashboard observation, and Hermes/MCP
  boundaries narrow.
- Reconciled and closed implemented GitHub issues #4, #5, #6, and #7 with
  evidence comments; verified local Markdown links during release preparation.
- Documented the npm `0.7.0` divergence as older June 2026
  accountability/live-monitor SDK history, with forward-only synchronization
  recommended for any future npm publication. This source/GitHub release does
  not publish npm.

### Boundaries

- SafeLoop governs actions routed through SafeLoop-managed execution paths, not
  arbitrary OS activity or universal process containment.
- Shell proof covers the governed process invocation, execution context, exit
  result, and output digests; it does not prove every downstream side effect of
  that process.
- HTTP proof covers the governed request/response transaction, not the remote
  system's business outcome.
- MCP proof covers the governed call/result unless explicit downstream evidence
  is linked; it does not automatically prove all downstream side effects.

## 0.2.0-rc3 - Execution-context binding (historical release candidate)

Remediates the execution-context substitution family that RC2 identified and
partly closed. RC1 and RC2 remain unchanged as historical audit evidence.

### Security — BREAKING

- **The agent can no longer approve its own actions.** `/v1/approval/grant` was
  protected by the same daemon-wide credential as `/v1/action/propose`. Because
  an agent must hold that credential to propose anything at all, it could grant
  its own held actions and then redeem and execute them — proposed,
  self-approved, executed, with a free-text `approver` string recorded as though
  a person had decided. Every execution-context check downstream passed
  honestly, because nothing had been substituted.

  Approval routes now require a **separate operator credential**, kept in its own
  `0600` `operator-credential.json`, created on first daemon start, persistent
  across restarts, absent from the connection file the agent reads, and
  classified as a sensitive path so a governed read of it is refused. The
  runtime credential is refused on those routes with `401`.

  **Migration:** deployments using one credential for everything will see `401`
  on `/v1/approval/grant`. That break is the fix. Give the operator credential
  to the human approval channel — `safeloop approve <approval_request_id>`, a
  dashboard, or an approval service — and never to the agent. Adapters must
  remove any `grantApproval` call; see `docs/HUMAN_APPROVALS.md`.

- **One approval request now grants exactly one token.** Each `grantApproval`
  minted a fresh `approval_id`, and the single-use claim was keyed on that id,
  so N grants against one request produced N independently redeemable tokens
  from a single human decision. A second grant for the same request now fails
  with `approval_already_granted` (HTTP 409). To run an action again, propose it
  again.

### Fixed

- **Shell cwd substitution.** A command authorized to run in one directory ran
  in another after a symlink swap. Reproduced on the RC3 baseline: `EXECUTED`,
  marker created outside the intended directory.
- **Git repository substitution.** A commit authorized for repository A landed
  in repository B. Reproduced: `EXECUTED`, approved repo unchanged, swapped
  repo received the commit.
- **HTTP redirect destination substitution.** `fetch` follows redirects by
  default; under 307/308 a `POST` authorized for host A was delivered with its
  body intact to host B, while evidence recorded host A. Managed requests now
  use `redirect: 'manual'` and report the target instead of following it.

### Added

- `src/runtime/executionContext.ts` — resolves, signs, and re-verifies
  security-significant execution context.
- Signed permit fields `execution_cwd` and `repository_identity`.
- Rejection reasons `cwd_context_changed`, `repository_context_changed`,
  `execution_context_verification_failed`.
- Conformance checks C36 (shell), C37 (git), C38 (HTTP), each verified to fail
  `NOT_CONFORMANT` when its guard is removed.
- `tests/runtime.executionContext.test.ts` — 30 regression tests asserting
  side-effect absence, not just status.

### Changed

- A managed HTTP request that would previously have followed a redirect now
  returns the 3xx with the target reported. Deliberate: SafeLoop does not
  deliver to a destination it did not authorize.

## 0.2.0-rc2 - Filesystem execution-time containment (historical release candidate)

Remediates **SL-RC1-HIGH-001**, a HIGH-severity filesystem authorization bypass
independently reproduced against the frozen RC1 (`e4d24ee`). RC1 remains
unchanged as historical certification evidence; it did **not** pass this audit.

### Fixed

- **Filesystem proposal→execution TOCTOU.** RC1 bound authorization to a path
  string and a proposal-time workspace classification, then wrote to that path
  without rechecking. Repointing a symlink between authorization and execution
  placed the write outside the workspace with `status: EXECUTED`. The executor
  now re-verifies containment immediately before every syscall and operates on
  the resolved real path.
- **Dangling symlinks resolved lexically.** `existsSync` follows symlinks, so a
  dangling symlink read as absent and was classified in-workspace while
  `writeFileSync` followed it out. The resolver now probes with `lstat`.
- **Workspace root swap.** Replacing the workspace directory with a symlink
  moved target and root together, preserving an "inside" reading. The resolved
  root is now bound into the permit.

### Added

- `workspace_relation` and `workspace_root` on `ExecutionPermit`, signed. They
  are carried on the permit rather than in the action fingerprint, which must
  remain deterministic and host-portable.
- Rejection reasons `workspace_relation_changed` and
  `workspace_verification_failed`.
- Conformance check **C35**: an in-workspace action cannot be redirected
  outside between authorization and execution. Verified to fail
  `NOT_CONFORMANT` when the guard is removed.
- `tests/runtime.workspaceToctou.test.ts` — 23 regression tests, each
  asserting both the status and the absence of the side effect.

### Known analogous defects, not fixed in this RC

The same defect class exists in the `git` and `shell` executors via `cwd`
symlink swap, and was reproduced. Both are out of scope for RC2 and are
reported separately.

## 0.2.0 - Local Runtime Governance (released 2026-08-10, tag v0.2.0)

Tagged at `01d73bec3500901a1c1e203fb532f0511c9958a4`.

SafeLoop becomes a local runtime governance layer for autonomous AI agents. The
defining change: for managed paths, the thing that decides and the thing that
acts are now the same thing.

### Added

- `safeloop.runtime.v1` protocol: 26 JSON Schema contracts under `protocol/schemas/`.
- Deterministic canonical action model and SHA-256 action fingerprints.
- Bound approvals: HMAC-signed, action-bound, single-use, atomically redeemed
  for an execution permit.
- Execution permits: the only authorization a managed executor accepts.
- Local runtime daemon on loopback HTTP plus a unix socket, with two-layer
  authentication and graceful shutdown.
- Managed executors for shell, filesystem, git (24 structured operations), HTTP,
  and downstream MCP.
- Memory candidate fingerprints, persistence permits, and provenance records.
- Reference governed memory store for conformance.
- Four data-driven governance profiles: coding, research, assistant, strict-local.
- MANAGED / UNMANAGED / DISABLED path model; an enabled consequential UNMANAGED
  path prevents full-profile certification.
- `safeloop daemon`, `safeloop run -- <agent>`, `safeloop status`,
  `safeloop certify`, `safeloop profiles`, `safeloop init --agent`.
- Conformance suite: 34 checks, applicability-aware, human and JSON output.
- TypeScript runtime SDK and a first-class Python adapter SDK.
- Adversarial test suite and a live Hermes bound-approval proof.

### Changed

- Hermes reference adapter migrated from adapter-level approved-context to bound
  approval tokens, and from decision-only governance to SafeLoop-performed
  execution for managed families.
- Budgets and circuit breakers are admission control at the executor call site
  rather than inputs to a risk score.

### Fixed

- **Approval double-spend.** The approval state store did read-modify-write on a
  shared JSON file, so two concurrent redemptions could both succeed. Claims are
  now made by exclusive file create, atomic across processes.
- **Memory TOCTOU.** A decision did not bind to the candidate it governed, so a
  safe candidate could be approved and a modified one persisted.
- **Profile default disposition.** `default_disposition` seeded the
  most-severe-wins reduce, so a restrictive default swallowed every ALLOW rule
  beneath it. It now applies only when no rule matches.

### Security

- Runtime signing secret is generated, stored `0600`, and never appears in any
  payload, event, log line, or error message.
- SafeLoop trust variables are stripped from child process environments.
- Captured output is secret-redacted and size-bounded before reaching evidence.
- Raw credentials in HTTP headers are refused in favour of credential references.
- No new runtime dependencies were added.

### Boundary

SafeLoop governs actions routed through SafeLoop-managed execution paths. It is
not a kernel security module, EDR, antivirus, firewall, IAM system, universal
syscall interceptor, arbitrary process container, or OS sandbox.

## Current branch - historical pre-v0.2 work

This branch consolidates SafeLoop as a local-first agent governance and accountability layer.

### Added

- MCP stdio server support for `safeloop.checkCommand`, `safeloop.runCommand`, `safeloop.recordActivity`, and `safeloop.status`.
- MCP command gateway with specialist-aware command checks and guarded execution.
- Specialist governance APIs for deterministic routing, tool validation, context-bound delegation, review validation, and effect guard coverage.
- CommandGuard process diagnostics including `stdout`, `stderr`, `exitCode`, `signal`, `cwd`, `durationMs`, `timedOut`, `spawnError`, and `failureKind`.
- Trace-first local dashboard shell with Decision Inspector, governance strip, operational diagnostics, timecard/cost visibility, and malformed JSONL tolerance.
- Local Codex-governed workflow demo that proves allow, review, block, specialist-denied, and effect-guard-denied paths without fake OpenAI API integration.
- Local policy config and CLI commands: `safeloop init`, `safeloop check`, and `safeloop run`.
- Sidecar ledger integrity commands: `safeloop ledger seal` and `safeloop ledger verify`.
- MCP usability commands: `safeloop mcp serve`, `safeloop mcp doctor`, `safeloop mcp print-config hermes`, and `safeloop mcp mcporter`.
- Approval-aware `CommandGuard` execution with context-bound approval token redemption before guarded command execution.
- Governed memory adapter behavior for allow, TTL, merge, quarantine, review, and reject decisions.
- Handoff governance checks that prevent delegated work from widening inherited command or target authority.
- Native Python client tests and development setup instructions.

### Notes

- SafeLoop remains a cooperative local governance layer, not an OS-level sandbox.
- Current branch verification has 56 Jest suites / 394 Jest tests plus 13 Python tests passing locally.
- `npm audit --audit-level=moderate` reports 0 vulnerabilities after dependency remediation.
- No npm publish, GitHub release, tag, merge, or production website deployment has been performed by this changelog update.

## v0.7.0

Safeloop v0.7.0 adds the local live loop monitor, event stream, cost tracking, steering intelligence, goal drift detection, and release readiness scoring.

## v0.8.0 - Oversight Intelligence (v0.8.0)

v0.8.0 introduces the Oversight Intelligence Layer and a first Live Agent Activity + Handoff Flow feature slice. Key additions center on visibility and accountability for agent loops:

### Added

- Oversight Intelligence: loop timecards with oversight scoring, proactive warnings, anomaly detection, explainability coverage, feedback events, and recommended actions.
- Live Agent Activity + Handoff Flow (monitor slice): active agents, recent activity stream, handoff-to-handoff flow, and token-cost pulse.
- `appendEvent`, `readEvents`, `streamEvents`, `recordModelUsage`, `setModelPricing`, `calculateCost`, `getCaseCostSummary` (model usage & cost primitives).
- `recordSteeringProfile`, `compareSteeringRuns`, `detectGoalDrift`, `calculateReadinessScore` (steering & readiness primitives).
- Live monitor CLI and dashboard API: viewModel now exposes `oversight` and `liveActivity` slices for UI clients.

### Notes

- v0.8.0 focuses on visualization and reporting: it warns, scores, and visualizes loops and handoffs but does not enforce hard stops.
- The Live Agent Activity panel is a first, reversible slice to make the monitor feel alive. Hard-stop enforcement is planned for v0.9.

## v0.6.0 - Previous

Safeloop v0.6.0 introduced the Agent Adapter Protocol and the current accountability + handoff surface.

### Added

- `createAgentSession`
- `processAgentEvent`
- `querySafeloop`
- `createCaseFile`
- `generateHandoffManifest`
- `exportAgentSessionMarkdown`
- `exportAgentSessionJSON`
- `exportSafeloopQueryMarkdown`
- `exportSafeloopQueryJSON`

### Notes

- Portable Case Files now cover participants, attachments, approvals, risks, and handoffs
- Query reports now include safety-summary, release-readiness, governance-audit, and evidence-summary flows
- The protocol remains local-first and explicit

## v0.1.0 - Released 2026-06-13

Initial public launch candidate for the local AI agent governance SDK.

### Added

- `createBreaker`
- `BREAKER_PRESETS`
- `createCodingAgentBreaker`
- `toMarkdownReport`
- `createAgentRunLedger`
- `createPolicyGate`
- `live simulation harness in `examples/breaker-live-simulation.ts`

### Notes

- GitHub v0.1.0 release completed
- npm publish completed: `safeloop@0.1.0`
- Final npm registry install test passed
- External consumer test verified Policy Gate, Action Ledger, Circuit Breaker reports, token usage reporting, and no undefined/crashes
- Breaker runtime supervision for agent loops
- Policy gating before execution
- Action ledger recording for review and auditability
- Markdown reports for human-readable run summaries
