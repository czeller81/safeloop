# SafeLoop Policy and Configuration Lifecycle

Phase 6 adds versioned lifecycle governance around the policy/profile material that SafeLoop uses to decide agent actions.

Policy lifecycle governance does not rewrite historical decisions.

Phase 6.1 makes lifecycle authority fail closed on corrupt storage. Missing storage is distinct from malformed or unsupported storage; only missing first-use storage may be bootstrapped by explicit baseline import/session startup. Corrupt storage is preserved for inspection and is not treated as an empty lifecycle.

Phase 6.2 routes authoritative lifecycle mutations through one process-safe transaction helper. Creation, validation, approval, activation, rollback, and baseline import acquire the lifecycle lock, operate on one store revision, advance the monotonic revision on commit, and report failure before durable success is claimed.

Rollback changes the active future policy state; it does not erase actions or decisions made under the rolled-back version.

## Architecture

```text
policy/config draft
  -> canonical immutable version
  -> structural validation
  -> golden controls
  -> approval
  -> revisioned transaction commit
  -> decision provenance
  -> telemetry/drift detection
  -> controlled rollback
```

## Policy Bundles

A policy bundle is an immutable, secret-safe copy of the governance profile material needed to reproduce a decision. It includes:

- `bundle_id`
- `version`
- `schema_version`
- `profile_id`
- `created_at`
- `created_by`
- `content_hash`
- `status`
- sanitized profile content
- sanitized metadata

Bundle hashes use deterministic canonical JSON. The same semantic content produces the same hash; material policy changes produce different hashes. Secret-like keys are stored as references/redacted values, not raw secrets.

## Configuration Snapshots

A configuration snapshot captures governance-relevant runtime configuration:

- active policy bundle reference and hash
- profile ID
- budgets
- managed paths
- memory write policy and confidence threshold
- runtime controls
- launch-environment variable names and unset names, not values
- adapter version family
- feature flags that affect governance
- model/provider identifier when present
- protocol and event schema versions

It deliberately excludes bearer tokens, API keys, passwords, credentials, private keys, and irrelevant environment noise.

## Lifecycle State Machine

Normal transitions:

```text
DRAFT -> VALIDATED -> APPROVED -> ACTIVE -> SUPERSEDED / RETIRED
```

Rollback can reactivate a previously validated known-good `SUPERSEDED` or `ROLLED_BACK` bundle, producing a new activation record. Invalid or rejected bundles cannot activate.

Rejected transitions include:

- `DRAFT -> ACTIVE`
- `INVALID -> ACTIVE`
- `REJECTED -> ACTIVE`

## Validation and Golden Controls

Validation checks:

- supported schema version
- bundle hash integrity
- profile structural validity
- budget, threshold, managed-path, memory-policy, and runtime-control shape
- direct stored config content hash when resolving active or historical configs
- bounded policy payload size, nesting depth, rule count, array length, string length, and metadata size

### Governance family applicability

The golden-control set is versioned as `phase6-v3`. Every governance family the rule engine can dispatch on, plus every cross-cutting mechanism a bundle can materially alter, carries an explicit classification. A family is never silently omitted.

| Family | Applicability | Reason |
| --- | --- | --- |
| `filesystem` | REQUIRED | Rules match `action_kind` filesystem and decide read/write/delete dispositions. |
| `shell` | REQUIRED | Rules match `action_kind` shell; destructive command detection feeds rule matching. |
| `git` | REQUIRED | Rules match `action_kind` git, including destructive git operations. |
| `http` | REQUIRED | Rules match `action_kind` http and gate authenticated mutations and egress. |
| `mcp` | REQUIRED | Rules match `action_kind` mcp and gate consequential downstream tool calls. |
| `delegation` | REQUIRED | Rules match `action_kind` delegation and decide whether sub-agent spawning is governed. |
| `memory` | REQUIRED | `memory_write_policy` and `minimum_memory_confidence` are read directly by `verifyCandidateMemory`. |
| `sensitive_paths` | REQUIRED | Rules match the `sensitive_path` fact, so a bundle can stop treating credential paths as sensitive. |
| `governance_config` | REQUIRED | Rules match the `governance_config` fact, so a bundle can stop protecting SafeLoop's own control plane. |
| `workspace_boundary` | REQUIRED | Rules match the workspace relation fact, so a bundle decides how out-of-workspace side effects are gated. |
| `budgets` | REQUIRED | `profile.budgets` is passed verbatim to `createBudgetTracker`, the pre-execution admission check. |
| `custom` | NOT_APPLICABLE | An open extension point with no fixed operation semantics and no canonical dangerous exemplar; a control would assert invented policy behavior. Rules matching `custom` are still evaluated by the same rule engine at runtime. |
| `breaker` | NOT_APPLICABLE | `GovernanceProfile` declares no breaker fields. `runtimeCore` builds the breaker with `createRuntimeCircuitBreaker({ storageOptions })` and thresholds are code defaults. No bundle can raise, lower, or disable them. |
| `permit` | NOT_APPLICABLE | Permit issuance and redemption are HMAC-signed over fixed claims and verified against a runtime secret. `GovernanceProfile` contributes no permit field. |
| `execution_context` | NOT_APPLICABLE | Workspace relation, workspace root, and execution cwd are signed into the permit at proposal time and re-resolved by the executor in code. The part a bundle does control - which workspace relation is gated - is covered by `workspace_boundary`. |

### Fail-closed coverage

Validation fails closed when a required control is missing, fails, errors, returns an undeterminable outcome, when a control ID is duplicated, when a control is declared against a NOT_APPLICABLE family, when the control-set version does not match, or when coverage is otherwise incomplete.

`golden_controls_passed` is true only when every required control actually ran and passed. The activation record carries the full manifest - control-set version, every control's family, expected outcomes, observed outcome, and status - so an auditor never has to trust the boolean.

Controls exercise production paths only: `evaluateProfile` for dispositions, `verifyCandidateMemory` wired exactly as `runtimeCore` wires it, and `createBudgetTracker` for budget admission.

### Budget semantics

`createBudgetTracker` treats an absent limit as unlimited, so `budgets: {}` silently removes the pre-execution admission check. A bundle must therefore declare `maximum_actions`; remaining categories stay optional, matching the tracker's own semantics. The behavioral control exhausts a real tracker built from the candidate's own limits and requires the verdict to flip to denied. A budget that cannot be demonstrated to bind within the control's bounded probe is reported `BUDGET_NOT_DEMONSTRABLE` and fails closed, which catches effectively unlimited budgets without introducing an arbitrary maximum.

Validation proves structure and defined behavioral controls, not that every future policy outcome is desirable.

## Activation

Activation requires an approved bundle and re-runs validation inside the same lifecycle transaction as the active pointer update. If activation fails before the transaction commits, the previous active bundle remains authoritative. Repeated activation with the same request ID, or activation of an already active bundle, returns the existing authoritative activation rather than creating duplicate active state.

New governance decisions resolve one complete active policy/config state at proposal evaluation start. The proposal hot path is read-only with respect to lifecycle authority: it verifies the active profile-scoped bundle/config and fails closed on drift instead of importing, activating, or repairing state. A lightweight verified-provenance cache is invalidated when the lifecycle store file changes or a lifecycle mutation writes a new revision.

## Decision and Execution Provenance

Every runtime governance decision now carries compact policy/config references:

- policy bundle ID and version
- policy hash
- configuration snapshot ID
- configuration hash
- runtime version
- protocol version
- event schema version
- profile

Immediate execution permits are signed with the same provenance. Held approval flows preserve the proposal-time provenance and carry it into the permit when the approval is redeemed.

## In-Flight Change Semantics

If policy changes after a proposal is held for approval, the approval redemption still performs the existing safety re-evaluation to ensure approval is applicable. The resulting execution permit remains bound to the proposal-time policy/config provenance rather than silently rebinding to the new active version.

## Rollback

Rollback is one authoritative lifecycle transaction. It validates the target bundle, changes the profile-scoped active pointer, marks the prior active bundle rolled back where applicable, appends rollback events, appends the rollback activation record, and advances the store revision in one durable commit. If the transaction fails before commit, the previous active bundle remains authoritative and no half-rollback is persisted. It preserves the version being rolled back from and any decisions already made under it.

History remains:

```text
v1 active -> v2 active -> rollback activation to v1
```

not:

```text
v1 active only
```

## Drift Detection and Startup Integrity

The lifecycle store validates the active pointer, policy bundle hash, and configuration snapshot hash. Drift states are:

- `NO_DRIFT`
- `DRIFT`
- `UNKNOWN`

SafeLoop does not silently repair drift in Phase 6. Drift is exposed through lifecycle status and Phase 5 operational telemetry/health.

## Audit Events

Lifecycle operations append policy lifecycle events for creation, validation, approval, activation, supersession, rollback, activation failure, validation failure, and drift-related status. Store events are authoritative and include revision context.

Event-stream export is staged during the mutation and flushed only after the authoritative store is durably written: compute/validate, construct next state, commit, then emit. If the transaction throws, staged exports are discarded with the uncommitted store, so a failed activation never leaves a `policy.bundle.validated` or `policy.bundle.activated` line claiming a commit that did not happen. In the other direction, export remains best effort: an export failure after commit degrades telemetry/export health only and never rolls back committed lifecycle state.

## CLI and API

CLI:

```text
safeloop policy-lifecycle status
safeloop policy-lifecycle list
safeloop policy-lifecycle import-baseline --profile coding
safeloop policy-lifecycle create --profile coding --version v2
safeloop policy-lifecycle validate --bundle <id>
safeloop policy-lifecycle approve --bundle <id>
safeloop policy-lifecycle activate --bundle <id>
safeloop policy-lifecycle rollback --target <id>
safeloop policy-lifecycle diff --left <id> --right <id>
```

Daemon read routes require the runtime credential. Mutation routes require the operator credential.

## Lifecycle Scope

Lifecycle scope is `PROFILE_SCOPED_LOCAL`. Active policy state is maintained per profile in one local lifecycle store. Tenant labels may be recorded as metadata and activation rejects explicit mismatches, but the lifecycle store is not a tenant isolation boundary and does not claim tenant-specific policy administration. Existing runtime/session tenant authorization remains separate from lifecycle version governance.

## Input Limits

Phase 6.2 lifecycle input limits are:

- `MAX_POLICY_PAYLOAD_BYTES`: 512 KiB
- `MAX_NESTING_DEPTH`: 48
- `MAX_RULE_COUNT`: 500
- `MAX_ARRAY_LENGTH`: 1000
- `MAX_STRING_LENGTH`: 16 KiB
- `MAX_METADATA_BYTES`: 64 KiB

Over-limit lifecycle input is rejected with a structured `lifecycle_input_limit_exceeded:*` error before persistence. Policy semantics are not silently truncated.

## Limitations

- Policy lifecycle is not a Git replacement.
- Dry replay and broad historical impact analysis are foundation-level only and remain candidates for a later phase.
- Prometheus-native policy lifecycle export is not added; metrics remain in the Phase 5 JSON telemetry foundation.
- MCP consequential detection reads separator-delimited tool names (`snake_case`, `kebab-case`, dotted, slashed), which is what MCP servers use. `canonicalizeAction` lowercases tool names for case-insensitive matching, so a camelCase name collapses to a single token and is no longer segmentable; splitting a collapsed token by prefix would re-gate benign names such as `deleteditems`. Such calls stay governed and recorded by `mcp.call` rather than silently allowed. This behavior is asserted in tests so it cannot regress unnoticed.
- Golden controls prove that named governance families are present and behave, not that a candidate policy is good. `custom`, `breaker`, `permit`, and `execution_context` are explicitly NOT_APPLICABLE for the architectural reasons recorded above; breaker, permit, and execution-context enforcement is exercised by the runtime suites rather than by lifecycle validation.
