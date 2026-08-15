# SafeLoop Policy and Configuration Lifecycle

Phase 6 adds versioned lifecycle governance around the policy/profile material that SafeLoop uses to decide agent actions.

Policy lifecycle governance does not rewrite historical decisions.

Rollback changes the active future policy state; it does not erase actions or decisions made under the rolled-back version.

## Architecture

```text
policy/config draft
  -> canonical immutable version
  -> structural validation
  -> golden controls
  -> approval
  -> atomic activation
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
- rule and configuration shape
- positive golden control
- negative golden control

The positive control checks a known safe read path. The negative control checks a dangerous outside delete path and requires a blocking disposition such as `DENY`, `STOP_AGENT`, `REQUIRE_APPROVAL`, or `PAUSE`.

Validation proves structure and defined behavioral controls, not that every future policy outcome is desirable.

## Activation

Activation requires an approved bundle and re-runs validation immediately before the atomic active pointer update. If activation fails before the atomic write, the previous active bundle remains authoritative. Repeated activation with the same request ID is idempotent.

New governance decisions resolve one complete active policy/config state at proposal evaluation start.

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

Rollback creates new lifecycle events and a new activation record pointing at a previous known-good version. It preserves the version being rolled back from and any decisions already made under it.

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

Lifecycle operations append policy lifecycle events for creation, validation, approval, activation, supersession, rollback, activation failure, validation failure, and drift-related status. These events use the existing event stream and are visible to operator systems that read that stream.

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

## Tenant Scope

Policy lifecycle state is global by default in the current SafeLoop runtime. Tenant-specific bundles may carry a `tenant_id`, and activation rejects mismatched tenant activation requests. SafeLoop does not claim full tenant-specific policy administration beyond that explicit bound in this phase.

## Limitations

- Policy lifecycle is not a Git replacement.
- Dry replay and broad historical impact analysis are foundation-level only and remain candidates for a later phase.
- Prometheus-native policy lifecycle export is not added; metrics remain in the Phase 5 JSON telemetry foundation.
