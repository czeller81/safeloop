# Managed Execution

## MANAGED / UNMANAGED / DISABLED

Every consequential path in an integration is declared as exactly one of:

| State | Meaning |
| --- | --- |
| **MANAGED** | The path is routed through SafeLoop. Decision and side effect are the same thing. |
| **DISABLED** | The path is not enabled in this profile. It cannot be reached at all. |
| **UNMANAGED** | The path is enabled and consequential, and SafeLoop does not control it. |

**An enabled consequential UNMANAGED path prevents full-profile certification.**
`safeloop certify` degrades that profile to `PASS_WITH_LIMITATIONS` and names
the path. This is not hideable behind wording: the rule is enforced in code and
tested (conformance check C34).

Declarations appear in `safeloop status`, `safeloop run`, `safeloop profiles`,
and the machine-readable conformance result.

## The choke point

`src/runtime/managedExecutor.ts` will not dispatch until, in order:

1. the request validates against the protocol schema
2. the submitted action is **re-canonicalized and its fingerprint recomputed**
3. the permit's signature, expiry, identity tuple, and fingerprint verify
4. the permit is atomically consumed
5. the circuit breaker is not open
6. the hard budget is not exhausted

Step 2 defeats argument substitution: the fingerprint comes from the bytes
actually submitted, never from a value the caller supplied.

Rejections are typed: `missing_permit`, `permit_forged`, `permit_expired`,
`permit_consumed`, `fingerprint_mismatch`, `identity_mismatch`,
`tenant_mismatch`, `task_mismatch`, `breaker_open`, `budget_exhausted`,
`invalid_runtime_state`, `unsupported_action_kind`, `executor_error`.

Every outcome becomes evidence and a ledger event.

## Shell

Structured argv is preferred: `{ argv: ["npm", "test"] }` runs without a shell,
so metacharacters in arguments are inert.

Shell interpretation is **declared, never inferred**: an action needing it must
say `{ command: "...", shell: true }`. The fingerprint therefore records whether
a shell was involved, so an approver who saw "no shell" cannot be handed a shell
invocation.

Captured: executable, argv, cwd, environment variable *names* (sensitive names
masked), timestamps, duration, exit status, signal, bounded and redacted
stdout/stderr, the decision, the fingerprint, and the permit id.

SafeLoop trust variables (`SAFELOOP_RUNTIME_SECRET`,
`SAFELOOP_RUNTIME_CREDENTIAL`, `SAFELOOP_HERMES_APPROVED`) are stripped from the
child environment so a governed process cannot re-enter the trust boundary.

Destructive-command logic is **not** duplicated here. That decision belongs to
the profile and the existing CommandGuard policy.

## Filesystem

Operations: `read`, `list`, `stat`, `create`, `write`, `overwrite`, `append`,
`mkdir`, `move`, `delete`.

Evidence records path, operation, observation status, and content hashes when
they are actually available ? never the file body. A governed agent editing a
file full of customer data should not cause that data to be copied into an audit
ledger that outlives the task.

Filesystem proof status is derived from observation quality:

| Observation | Verification status | Notes |
| --- | --- | --- |
| File state observed and complete SHA-256 computed | `VERIFIED` | Applies to files up to and including the 64 MiB evidence hash cap. |
| File state observed but size exceeds 64 MiB | `PARTIALLY_VERIFIED` | `hash_capped: true`; no full content hash is claimed. |
| Post-state cannot be observed or content cannot be read for hashing | `NOT_VERIFIABLE` | Unreadable paths are not represented as absent. |
| Delete post-state is confirmed missing | `VERIFIED` with after `ABSENT` | `deleted: true` is emitted only when absence is observed. |
| Post-state contradicts the intended transition | `FAILED` | For example, a delete target still present after the operation. |

Policy is workspace-relative. Containment is computed on resolved absolute paths
with `realpath` applied to the nearest existing ancestor, so a symlink inside the
workspace pointing outside it classifies as **outside**. When containment cannot
be determined the answer is `unknown`, and `unknown` gets the stricter policy —
never the looser one.

Credential and secret paths (`.ssh/`, `.aws/`, `.env`, `*.pem`, `*.key`,
`credentials.*`, the SafeLoop state directory, …) are denied regardless of
workspace.

## Git

Git is a first-class action family, not an opaque terminal string. `git push
--force origin main` and `git status` are not "two shell commands"; they are two
operations with very different consequences.

24 modelled operations: `status`, `diff`, `log`, `show`, `branch_list`,
`remote_list`, `add`, `commit`, `push`, `force_push`, `pull`, `fetch`,
`checkout`, `switch`, `branch_create`, `branch_delete`, `remote_add`,
`remote_set_url`, `remote_remove`, `reset`, `reset_hard`, `clean`, `tag_create`,
`tag_delete`.

Each maps to a **fixed argv template**. The agent supplies structured arguments;
SafeLoop decides the flags. That inversion is what stops `git commit -m "msg"`
from smuggling `--amend --no-verify` through the message field — verified by
test: a message of `msg" --amend --no-verify "` becomes the literal commit
subject and no flag is interpreted.

An operation absent from the table cannot be executed. There is no passthrough.

Approvals bind the exact repository, cwd, ref, arguments, message, and remote.

## HTTP

Distinguishes `read`, `write`, `authenticated_mutation`, and
`external_communication`. Evidence records method, scheme, host, port, and path
in the clear; query and body as hashes; credentials as a *reference only*.

Raw credentials in headers are rejected outright — the executor refuses
`Authorization`, `Cookie`, and `X-API-Key`, requiring `credential_reference`
instead, so the secret never enters the fingerprint or the ledger.

SafeLoop is not a firewall and does not intercept sockets. A process that opens
its own connection is outside the boundary.

## MCP

SafeLoop already speaks MCP as a server. This is the other direction: an agent
proposes a downstream MCP call, SafeLoop governs it, and only then does it reach
the downstream server.

**Tool availability is not governance.** A downstream tool reached through the
certified managed route cannot execute without a decision, because the executor
is only entered after a permit is verified and consumed.

When no downstream transport is configured, the executor refuses and reports
`mcp_managed: false` rather than pretending. Declaring the path MANAGED without
a transport would certify a lie.

## Breakers and budgets

Breaker states: `CLOSED` (normal), `WARNING` (constrained and recorded),
`OPEN`/`LOCKED` (consequential managed execution stops).

Budgets: actions, runtime, tokens, cost, retries. v0.1 expressed budgets as
scenario fields that fed risk scoring; a risk score is advisory. v0.2 checks
them as admission control at the executor call site, so exhaustion blocks a real
side effect.

Both are tested against real executor calls, not state objects: a permit issued
*before* the breaker opens or the budget drains still cannot execute afterwards.

## Failure posture

| Condition | Behaviour |
| --- | --- |
| Executor throws | `FAILED`, no side effect, recorded |
| Execution timeout | `TIMED_OUT`, process killed, partial work recorded |
| Permit state unreadable | rejected — a runtime that cannot prove single use does not authorize |
| Claim record corrupt | treated as an active claim (fail closed) |
| Ledger corrupt | detected by `verifyLedger` |
| Malformed protocol input | rejected before canonicalization |
| Unauthenticated call | 401, identical response for absent and wrong |
| Runtime unavailable | SDKs raise; adapters must fail closed, never proceed ungoverned |

High-risk consequential operations fail closed. The one deliberate availability
tradeoff: `/health` is unauthenticated so an operator can tell a stopped runtime
from an unreachable one; it exposes only liveness, version, and session count.

## Session inspection proof summaries

`safeloop session inspect <session_id>` now prints concise execution proof summaries when a session contains Phase 2 proof records. The default text view shows executor, operation, verification status, selected before/after state, result metadata, evidence IDs, and artifact IDs. It deliberately avoids dumping large structured proof JSON.

Use `--json` to inspect the full structured graph, including `execution_proofs`. The JSON shape remains additive so v0.2 historical sessions and Phase 1 work graphs remain readable.