# SafeLoop Approval Model

## The problem v0.2 exists to fix

The Hermes pilot certified `PASS_WITH_LIMITATIONS`, and the first limitation was
this: authorization was an adapter-level boolean.

```python
# v0.1 — plugins/safeloop_guard/__init__.py
"hasHumanApproval": os.getenv("SAFELOOP_HERMES_APPROVED", "").lower() in {"1", "true", "yes", "on"}
```

Any process able to set an environment variable turned every REQUIRE_APPROVAL
into ALLOW, for every action, for the whole session. The approval was not
attached to anything — not to an action, not to a moment, not to a person.

A second, quieter problem sat underneath it. Even where approvals were checked,
the pattern was:

```
evaluate() → "ALLOW" → caller performs some action later
```

Nothing tied the returned ALLOW to the action that actually ran.

## The v0.2 model

An approval authorizes **one exact action, once**.

```
ActionProposal
  → CanonicalAction
  → ActionFingerprint          (SHA-256 over the binding set)
  → REQUIRE_APPROVAL
  → ApprovalRequest            (bound to that fingerprint)
  → human decision
  → BoundApprovalToken         (HMAC-signed over fingerprint + identity)
  → atomic single-use redemption
  → ExecutionPermit            (for that fingerprint only)
  → managed execution, exactly once
```

Redemption yields a **permit**, not a boolean. There is no representation of
"this agent is approved" anywhere in the system — only "this exact action is
authorized".

## What a token binds

| Claim | Why it is bound |
| --- | --- |
| `action_fingerprint` | the approval is for this action and no other |
| `agent_id` | another agent cannot spend it |
| `task_id` | it does not leak into a later task |
| `session_id` | it does not survive into a new session |
| `scenario_id` | it does not cross a scenario boundary |
| `tenant_id` | it never crosses tenants |
| `issued_at` / `expires_at` | approvals go stale |
| `nonce` | 128 bits of entropy per token |
| `policy_version` | the policy context it was granted under |
| `approver` | who decided |

`signature` is HMAC-SHA256 over the canonical serialization of every claim
above, using the runtime secret. Editing any claim invalidates the signature.

## What redemption checks, in order

1. **Protocol version.** A mismatched version is rejected as forged.
2. **Signature.** Checked first, in constant time, so a forged token learns
   nothing about which claim it got wrong.
3. **Revocation and prior consumption.**
4. **Expiry.**
5. **Identity** — tenant, agent, task, session, scenario.
6. **Fingerprint.**
7. **Still-required.** The runtime re-evaluates the action. A token only lifts a
   REQUIRE_APPROVAL hold; it can never authorize an action policy now denies
   outright (`not_approval_required`).

Identity is checked before the fingerprint. Both reject, but since identity is
part of the fingerprint binding set, checking fingerprint first would report
every cross-tenant attempt as a generic `fingerprint_mismatch`. The ledger and
the conformance suite need to know which boundary was actually violated.

## Why `trace_id` is excluded from the binding

`trace_id` is deliberately **not** part of the fingerprint binding set. That is a
security decision, so it deserves an argument rather than an assertion.

**What `trace_id` is.** A correlation identifier for observability. The runtime
generates one per session (`newId('trace')`) and adapters may supply their own
for cross-system tracing. It groups related events in a ledger or a dashboard.

**What it is not.** It confers no authority and establishes no isolation:

- It is **caller-suppliable** on `ActionProposal`. An adapter can put any value
  there. A field an attacker controls cannot be a security boundary.
- It is **not** consulted by any policy rule. `ProfileRuleMatch` has no
  `trace_id` condition, and the risk engine never reads it.
- It gates **no** state. Sessions, tasks, tenants, budgets, breakers, approvals,
  and permits are all keyed by ids the runtime owns.
- The runtime **overwrites** every identity field on `propose`; `trace_id` is
  not in that set precisely because it is metadata, not identity.

**Why exclusion is required, not merely convenient.** Approval and execution are
different moments and frequently different traces: the proposal happens in the
agent's turn, the human decides later, and the execution follows. Binding a
correlation id would expire approvals for a reason unrelated to authority.

**What still constrains an approval.** Excluding `trace_id` cannot let an
approval cross a meaningful boundary, because the token remains bound to
`tenant_id`, `agent_id`, `task_id`, `session_id`, `scenario_id`, and the action
fingerprint — which itself covers `action_kind`, `tool`, `operation`,
`arguments`, `cwd`, `target`, `resource`, `method`, and `parent_agent_id`. Every
axis along which authority or isolation is actually defined is bound. Two
actions that differ only in `trace_id` are the same action by every measure that
governs what may happen.

**Conclusion: observability-only.** No stable execution-chain identifier is
needed, because `session_id` + `task_id` already provide the stable chain, and
both *are* bound. Regression coverage:
`tests/runtime.canonicalAction.test.ts` asserts `trace_id` changes do not change
the fingerprint and that it never appears in the canonical form;
`tests/runtime.boundApproval.test.ts` covers every bound axis rejecting.

## Atomic single use

The v0.1 approval store did read → check → append → write on a shared JSON file.
Two concurrent redemptions could both observe "not consumed" and both succeed.
Since a permit authorizes a real side effect, that is a double-spend.

v0.2 claims a token by **exclusively creating** a file:

```ts
openSync(path, 'wx')   // EEXIST if it already exists
```

`O_CREAT|O_EXCL` is atomic on POSIX and `CREATE_NEW` is atomic on Windows, and
`openSync` does not yield to the event loop, so the winner is unambiguous both
within a process and across processes.

Proven with 24 real OS processes racing one token id: exactly one winner
(`tests/runtime.atomicState.test.ts`).

**Failure posture.** If the claim directory cannot be read or written, the store
reports the claim as *not granted*. A runtime that cannot prove single use must
not authorize execution.

## Execution permits

A permit is the only thing a managed executor accepts. Before dispatch the
executor:

1. validates the request against the protocol schema
2. **re-canonicalizes the submitted action and recomputes its fingerprint** —
   a caller-supplied fingerprint is never trusted
3. verifies the permit signature, expiry, identity tuple, and fingerprint
4. atomically consumes the permit
5. confirms the circuit breaker is not open
6. confirms the hard budget is not exhausted

Step 2 is what defeats argument substitution. An agent that proposes action A,
receives a permit, then submits action B gets `fingerprint_mismatch` — because
the fingerprint is computed from the bytes actually submitted, not from what was
claimed earlier.

## Verified rejections

| Attack | Result |
| --- | --- |
| Replay a consumed token | `consumed` |
| Concurrent replay (16 attempts) | exactly 1 winner |
| Concurrent replay across 24 OS processes | exactly 1 winner |
| Forged signature | `forged` |
| Token signed with a different secret | `forged` |
| Claims edited after signing | `forged` |
| Revoked token | `revoked` |
| Expired token | `expired` |
| Modified arguments | `fingerprint_mismatch` |
| Modified command / operation | `fingerprint_mismatch` |
| Modified cwd | `fingerprint_mismatch` |
| Modified target | `fingerprint_mismatch` |
| Different tool or action kind | `fingerprint_mismatch` |
| Another tenant's token | `tenant_mismatch` |
| Another agent's token | `agent_mismatch` |
| Another task's token | `task_mismatch` |
| Another session's token | `session_mismatch` |
| Another scenario's token | `scenario_mismatch` |
| Approval for action A used for action B | `fingerprint_mismatch` |
| Token used where policy now says DENY | `not_approval_required` |
| Missing token | `unknown_token` |

Each is covered by a test that also asserts the side effect did not occur.

## Token delivery

Tokens reach adapters through whatever channel an operator or approval UI
provides — in the Hermes reference adapter, a directory keyed by fingerprint.
**The delivery channel does not need to be trusted.** A token that is stolen,
copied, or replayed still fails redemption, because it is bound and single-use.

## The signing secret

Generated per runtime state directory, 32 random bytes, stored `0600` in a
`0700` directory. Never returned in any protocol payload, event, log line, or
error message. `describeSecret()` returns a truncated hash for status output, so
operators can confirm *which* secret signed a token without being able to read
it. Rotation invalidates every outstanding token and permit.
