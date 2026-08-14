# Approval-State Remediation Design Audit

Date: 2026-08-14

## Scope

This audit covers the approval / permit redemption defect found after the Phase
2 filesystem proof remediation. It does not change filesystem proof semantics.

## Root Cause

Proposal-time governance computes an effective disposition from both profile
rules and runtime risk:

```text
effective disposition = moreSevere(profile disposition, risk disposition)
```

Approval redemption reconstructed the approval requirement from profile rules
alone:

```text
approval_was_required = profile disposition == REQUIRE_APPROVAL
```

That discarded risk escalations. A proposal could be correctly held as
`REQUIRE_APPROVAL` by the risk engine, then fail redemption as
`not_approval_required` because the profile-only disposition was `ALLOW` or
`ALLOW_WITH_WARNING`.

## Lifecycle Trace

1. The caller submits an `ActionProposal`.
2. The runtime binds session-owned identity: agent, task, session, scenario, and
   tenant.
3. The bound action is canonicalized and fingerprinted.
4. Profile rules evaluate deterministic action facts.
5. Runtime risk evaluates the same canonical action and fingerprint.
6. The effective disposition is the more severe of profile and risk.
7. `ALLOW` / `ALLOW_WITH_WARNING` issues a signed execution permit.
8. `REQUIRE_APPROVAL` creates an approval request bound to the fingerprint and
   identity, and stores proposal-time execution context for later comparison.
9. Granting approval mints a signed bound approval token.
10. Redemption validates token integrity, identity, fingerprint, current
    approval requirement, and execution context.
11. Successful redemption issues a signed one-time execution permit.
12. Managed execution re-canonicalizes the submitted action, verifies and
    atomically consumes the permit, then dispatches to the executor.

## Persisted State

The approval request and token are bound to:

- action fingerprint
- agent id
- task id
- session id
- scenario id
- tenant id
- approval/token expiry
- signature under the runtime secret

The runtime also stores proposal-time execution context for approval ids so
redemption can reject context drift before issuing a permit.

## Risk Replayability

The current risk evaluation used by runtime proposals is deterministic for the
bound canonical action and runtime-owned session/task/tenant context. It is
therefore safe to replay at redemption for the same fingerprint and identity.
The replay must use the same bound action fields that the fingerprint validates;
it must not rely on caller-supplied identity.

## Chosen Fix

The remediation uses Option A: recompute the effective disposition at
redemption by evaluating both profile and runtime risk against the bound
canonical action, then applying `moreSevere(...)`.

This fits the current architecture because proposal already treats profile and
risk as active policy sources, while approval tokens already bind the canonical
action fingerprint and identity. Recomputing the same effective disposition
avoids trusting an unbound mutable boolean and preserves fail-closed behavior if
policy now denies the action.

## Security Invariants

- Approval validation is not skipped.
- `not_approval_required` remains a rejection for tokens spent when the current
  effective disposition is not `REQUIRE_APPROVAL`.
- Failed redemption never issues a permit.
- Permit fingerprint, identity, expiry, signature, and single-use checks remain
  unchanged.
- An approval cannot authorize a different action or changed execution context.

## Expected Remediation Tests

- Risk-escalated HTTP read: profile `ALLOW_WITH_WARNING`, risk
  `REQUIRE_APPROVAL`, redemption succeeds and permit executes.
- Risk-escalated filesystem delete inside workspace: profile
  `ALLOW_WITH_WARNING`, risk `REQUIRE_APPROVAL`, redemption succeeds and permit
  executes.
- Production-target filesystem write inside workspace: profile `ALLOW`, risk
  `REQUIRE_APPROVAL`, redemption succeeds and permit executes.
- Negative approval and permit tests continue to reject missing, wrong, expired,
  mismatched, cross-session, cross-tenant, and spent authority.
