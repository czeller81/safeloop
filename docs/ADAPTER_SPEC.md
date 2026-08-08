# SafeLoop Adapter Specification

An adapter connects one agent framework to the SafeLoop runtime. It translates
native agent concepts into `safeloop.runtime.v1` and obeys what comes back.

## The one rule

**Adapters must not implement SafeLoop policy.**

An adapter that decides anything is a second policy engine to keep in sync, and
the two will eventually disagree. Adapters translate and obey. Every
disposition, permit, and memory decision comes from the runtime.

## Lifecycle

| Operation | Purpose |
| --- | --- |
| `register_agent` | declare identity: id, name, type, model, provider |
| `start_session` | establish the session; receive a session credential |
| `start_task` | begin a unit of governed work |
| `propose_action` | submit an `ActionProposal`; receive a `GovernanceDecision` |
| `execute_managed_action` | execute under an `ExecutionPermit` |
| `request_approval` | surface a held action to a human |
| `redeem_approval` | exchange a bound token for a permit |
| `record_execution_result` | performed by the runtime automatically |
| `propose_memory` | submit a `MemoryCandidate` |
| `persist_authorized_memory` | activate under a `MemoryPersistencePermit` |
| `finish_task` / `finish_session` | close cleanly; seal evidence |

## Identity propagation

An adapter supplies identity **once**, at `start_session`. After that the
runtime is authoritative: `propose` overwrites `agent_id`, `parent_agent_id`,
`task_id`, `session_id`, `scenario_id`, and `tenant_id` from the session record.

Adapters should still send `trace_id` for correlation. It is carried but
excluded from fingerprints.

## Obligations

### 1. Fail closed

If the runtime is unreachable, times out, or returns an error, a consequential
action must **not** proceed. Falling back to ungoverned execution defeats the
entire system. The Python SDK raises `SafeLoopRuntimeError` with
`code="runtime_unavailable"` precisely so this cannot be mistaken for an allow.

### 2. Do not perform the side effect yourself

For MANAGED families the runtime performs the action. An adapter that receives
ALLOW and then acts on its own has reintroduced the gap v0.2 closed: nothing
ties the decision to what ran.

In middleware-style frameworks this means **not** calling the framework's
`next_call` for managed families. The Hermes reference adapter returns
SafeLoop's execution result instead.

### 3. Deny what you cannot manage

A consequential tool SafeLoop cannot model must be **denied**, not passed
through. Passing it through claims governance over a path SafeLoop does not
control. Declare it DISABLED in the profile, or accept UNMANAGED and the
certification limitation that follows.

### 4. Model actions structurally

Do not flatten everything into one opaque string. `git push --force` should
become `operation: "force_push"`, not a shell command containing the word
"force". Structural modelling is what lets policy be precise rather than
pattern-matching English.

Where a command cannot be modelled faithfully, keep it as a governed shell
action rather than reshaping it into something policy treats more leniently.

### 5. Surface holds; do not swallow them

REQUIRE_APPROVAL is a normal outcome, not an error. Report the
`approval_request_id` and `action_fingerprint` so a human can act, and resume
with the same proposal once a token exists.

### 6. Never handle raw secrets

Use `credential_reference`, not credentials. Never log a session credential, a
runtime credential, or a token.

## Minimal adapter (Python)

```python
from safeloop_client.runtime import connect, SafeLoopRuntimeError

client = connect()                      # reads the 0600 connection file
session = client.start_session(agent_id="my-agent", tenant_id="acme",
                               workspace="/path/to/repo", profile="coding")
task = session.start_task(goal="run the tests")

try:
    outcome = session.execute_shell(["npm", "test"], task)
except SafeLoopRuntimeError:
    raise                               # fail closed; never fall back

if outcome.held:
    grant = client.grant_approval(outcome.approval_request_id, "operator")
    result = session.execute_approved(outcome.proposal, task, grant["token"])
elif outcome.executed:
    print(outcome.stdout)
else:
    print("refused:", outcome.disposition)

session.finish()
```

## Minimal adapter (TypeScript)

```ts
import { createSafeloopClient } from 'safeloop/runtime/client';

const client  = createSafeloopClient();
const session = await client.startSession({
  agent: { agent_id: 'my-agent' }, tenant_id: 'acme',
  workspace: '/path/to/repo', profile: 'coding',
});
const { task_id } = await session.startTask({ goal: 'run the tests' });

const outcome = await session.execute({ kind: 'shell', argv: ['npm', 'test'] }, task_id);

if (outcome.held) {
  const grant = await client.grantApproval({
    approval_request_id: outcome.decision.approval_request!.approval_request_id,
    approver: 'operator',
  });
  await session.executeApproved(outcome.proposal, task_id, grant.token);
}
await session.finish();
```

## Declaring managed paths

Every adapter declares, per profile, what it covers:

```json
[
  { "path": "shell",      "state": "MANAGED",  "consequential": true,  "certification_impact": true,
    "mechanism": "SafeLoop managed shell executor" },
  { "path": "browser",    "state": "DISABLED", "consequential": true,  "certification_impact": false },
  { "path": "updater",    "state": "UNMANAGED","consequential": true,  "certification_impact": true,
    "notes": "Runs outside the model-called tool boundary." }
]
```

Be accurate rather than flattering. A declaration that overstates coverage
produces a certification that is worth nothing.

## Conformance

Run `safeloop certify --adapter <name> --profile <profile> --json`. An adapter
should reach `PROFILE_CONFORMANT`, or `PASS_WITH_LIMITATIONS` with each
limitation named. See `docs/CONFORMANCE.md`.
