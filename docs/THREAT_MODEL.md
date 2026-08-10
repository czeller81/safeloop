# Threat Model

SafeLoop is a cooperative local-first governance layer. It is designed to mediate agent actions that route through SafeLoop, record evidence, and make bypasses easier to detect.

## In Scope

- policy bypass attempts through command routing
- approval bypass for guarded actions
- approval replay, token forgery, token expiry, revocation, and context mismatch
- policy engine failure for high-risk actions
- scenario drift
- repeated tool calls and loops
- cost/token budget overruns
- malformed event lines
- ledger tampering after sealing
- unverified evidence claims
- evidence tampering after hash capture
- unsafe durable memory writes
- memory poisoning attempts
- identity spoofing through self-reported agent metadata
- tenant boundary mistakes in scenario contracts
- MCP and connector boundary clarity

## Out of Scope Without Additional Controls

- OS-level process isolation
- network firewalling
- kernel-level filesystem controls
- direct private agent tools that do not call SafeLoop
- direct API calls that bypass a SafeLoop adapter
- direct publishing, messaging, deployment, or payment tools that bypass SafeLoop

Use OS sandboxing, least-privilege accounts, local firewall rules, endpoint controls, and network isolation for non-cooperative containment.

## High-Value Controls Already Present

- command guard blocks or holds commands before execution
- MCP gateway routes command checks and execution
- specialist permission checks
- effect guard adapter coverage diagnostics
- local policy config and doctor checks
- malformed JSONL tolerance
- ledger seal and verify
- runtime policy decisions
- runtime circuit breaker
- memory verification API
- HMAC-signed approval tokens
- fail-closed policy wrapper
- artifact hash verification and evidence promotion rules

## Remaining Risks

- Connectors must opt in to runtime policy evaluation.
- Approval persistence and expiration are intentionally basic.
- Approval tokens are in-memory and session-scoped.
- Event identity is locally generated and can be spoofed by a malicious local writer.
- Tenant isolation is policy/context based, not an authenticated multi-tenant service boundary.
- Ledger seals detect post-seal changes but do not prevent writes.
- Dashboard visibility depends on local event quality.
- `npm audit` currently reports dependency advisories that should be remediated before broader production distribution.

---

# v0.2 Runtime Threat Model

## Trust boundaries

| Boundary | Control |
| --- | --- |
| Host process → daemon | Runtime credential, `0600` connection file, loopback-only bind |
| Caller → session | Session credential bound to one session |
| Caller → identity | Identity is runtime-owned after session start; caller claims are overwritten |
| Decision → side effect | Execution permit: signed, expiring, single-use, fingerprint-bound |
| Candidate → durable memory | Persistence permit bound to the candidate fingerprint |
| Parent → sub-agent | Exact inheritance; widening rejected; budgets capped at parent remaining |

## Assets and their protection

| Asset | Protection |
| --- | --- |
| Runtime signing secret | 32 random bytes, `0600` in a `0700` directory, never in any payload/log/error |
| Runtime credential | `0600` connection file; constant-time comparison |
| Session credential | Bound to one session; not transferable |
| Approval tokens | HMAC-signed, single-use, atomically consumed |
| Ledger | Append-only, sealed, tamper-detectable |
| Captured output | Secret-redacted and size-bounded before reaching evidence |

## Threats addressed in v0.2

| Threat | Mitigation | Verified by |
| --- | --- | --- |
| Ambient approval (env var grants authority) | Bound tokens only; no approved-state exists | Hermes live proof |
| Approval replay | Atomic single-use claim | 16-way + 24-process races |
| Approval forgery | HMAC over the full claim set | Adversarial suite |
| Argument/context substitution | Fingerprint recomputed from submitted bytes | Conformance C08–C13 |
| Approval double-spend across processes | Exclusive file create | 24 racing OS processes |
| Memory TOCTOU | Candidate fingerprint + persistence permit | Conformance C29 |
| Memory poisoning | Deterministic bypass detection; never activates | Conformance C27, red team |
| Workspace escape via symlink | `realpath` containment; unknown ⇒ outside | Red team |
| Privilege widening via delegation | Exact inheritance; `privilege_widening` | Conformance C22–C23 |
| Cross-tenant use of permits/approvals/memory | Tenant in every binding | Conformance C11–C13 |
| Execution after breaker or budget | Admission control at the executor | Conformance C20–C21 |
| Governance self-modification | Governance-config paths denied | Red team |
| Credential exfiltration in output | Redaction before evidence; header credentials refused | Redaction tests |
| Trust re-entry via child env | SafeLoop variables stripped from child processes | Managed execution tests |
| Unauthenticated local caller | Bearer credential; identical response absent/wrong | Daemon tests |

## Residual risks

- **A local process with the runtime credential can start sessions.** File
  permissions are the boundary. A process already running as the user can read
  a `0600` file. This is the same model as a Docker socket, and it is the limit
  of what a userspace runtime can offer.
- **A local process with the signing secret can mint tokens.** Same boundary.
- **SafeLoop does not intercept processes that do not route through it.** A
  program that opens its own socket or calls `execve` directly is outside the
  boundary. Use OS permissions, containers, network policy, and least-privilege
  credentials for non-cooperative containment.
- **Event identity is locally generated** and can be spoofed by a malicious
  local writer; ledger sealing detects post-seal edits but does not prevent
  writes.
- **Two Hermes paths are UNMANAGED** and classified non-consequential by
  judgement (see `docs/HERMES_REFERENCE_ADAPTER.md`).
- **The legacy substring risk heuristic produces false positives**, which makes
  SafeLoop stricter rather than looser.

---

# RC2 — Filesystem execution-time containment (SL-RC1-HIGH-001)

## What RC1 got wrong

RC1 bound authorization to a **pathname** plus a workspace classification
computed **at proposal time**. The filesystem executor then wrote to the
approved path string without rechecking. Symlinks are mutable, so:

```
propose  workspace/link/pwned.txt   (link → inside)   → ALLOW + permit
                 …attacker repoints link → outside…
execute  workspace/link/pwned.txt                     → EXECUTED, file lands outside
```

An independent audit reproduced this against the frozen RC1. The defect is
that **an authorized path string is not an authorized filesystem object**.

## What RC2 enforces

The sequence is now:

```
proposal → classify → policy → permit → redeem → EXECUTOR-TIME verification → side effect
```

`src/runtime/executors/filesystem.ts` re-verifies containment immediately
before every syscall, via `verifyContainment()` in `src/runtime/workspace.ts`.

Three facts are bound into the **signed permit** (not the action fingerprint,
which must stay deterministic and host-portable):

| Bound fact | Why |
| --- | --- |
| `workspace_relation` | the relation the authorization was granted under |
| `workspace_root` | the resolved workspace root at proposal time |

The rule is **equality**, not "inside":

| Authorized | At execution | Outcome |
| --- | --- | --- |
| inside | inside | execute |
| inside | outside | **reject** `workspace_relation_changed` |
| outside | outside | execute — approved outside-workspace work still runs |
| outside | inside | **reject** — not the object the human approved |
| unknown | unknown | execute if policy allowed it |
| any | unverifiable | **reject** `workspace_verification_failed` |

This preserves SafeLoop's policy model: the executor did **not** become a
workspace-only executor. An explicitly approved outside-workspace action still
executes, provided it is still outside.

## Two further defects found while remediating

**Dangling symlinks.** `existsSync` follows symlinks, so a *dangling* symlink
read as absent and the path resolved lexically — while `writeFileSync` happily
followed it. The resolver now probes with `lstat` and follows dangling links
manually, with a depth limit. This was also present at proposal time.

**Workspace root swap.** Binding the relation alone was insufficient: replacing
the workspace *directory* with a symlink moves the target and the root
together, so containment still read "inside" while the bytes landed elsewhere.
The resolved root is therefore bound too.

## Residual race — stated precisely

Between `verifyContainment()` and the syscall there remains a small
check-to-use window. RC2 materially narrows it rather than eliminating it:

- for follow-mode operations the syscall is issued against the **fully resolved
  real path**, so it no longer traverses the mutable component at all. An
  attacker must now win a race against a component of the *resolved* path.
- for `delete` and `move` the final component is deliberately not followed, so
  the entry itself is acted on rather than its target.

**Eliminating the race entirely would require descriptor-relative syscalls**
(`openat2` with `RESOLVE_BENEATH`, or `O_NOFOLLOW` on each component), which
Node does not portably expose. SafeLoop does **not** claim kernel-level
filesystem race elimination. The demonstrated proposal→execution window is
closed; a sub-syscall TOCTOU against the resolved path is not addressed in
userspace.

## Known analogous defects — NOT fixed in RC2

The same class was found in two other executors during the RC2 narrow review
and is **deliberately out of scope** for this remediation:

- **`git` cwd** — an approved `git commit` in repo A commits into repo B when
  the `cwd` symlink is swapped after approval. Reproduced: `status EXECUTED`,
  approved repo unchanged, swapped repo received the commit.
- **`shell` cwd** — a command approved with `cwd` inside the workspace runs
  with `cwd` outside it after a swap. Reproduced: marker file landed outside.

These are tracked separately and must be decided before any recertification
that claims a general execution-boundary guarantee. RC2 closes the filesystem
finding only.

---

# RC3 — Execution-context binding (shell, git, HTTP)

## The family, stated once

RC1 failed independent audit because authorization was bound to a *path
string*. RC2 fixed that for the filesystem and, during its mandatory analogous
review, reproduced the same defect twice more. RC3 investigated the network
case and found a third. All four are one architectural mistake:

> A cryptographically valid permit is insufficient if mutable execution context
> can redirect where its side effect lands.

| Executor | What was authorized | What received the side effect |
| --- | --- | --- |
| filesystem (RC1) | a path inside the workspace | a file outside it, via symlink swap |
| shell (RC2 found, RC3 fixed) | a command in directory A | the same command in directory B |
| git (RC2 found, RC3 fixed) | a commit in repository A | a commit in repository B |
| http (RC3 found and fixed) | a POST to host A | the same POST, body intact, to host B |

## What RC3 binds

`src/runtime/executionContext.ts` resolves security-significant context at
authorization time. It is signed into the permit — never into the action
fingerprint, which must stay deterministic and reproducible off-host.

| Signed permit fact | Bound for | Verified by |
| --- | --- | --- |
| `workspace_relation`, `workspace_root` (RC2) | filesystem | `executors/filesystem.ts` |
| `execution_cwd` | filesystem, shell, git | `verifyExecutionCwd()` |
| `repository_identity` | git | `verifyRepositoryIdentity()` |
| `resolved_target`, `resolved_destination` | filesystem | `verifyResolvedPath()` |
| `head_ref`, `head_commit` | git, writes only | `verifyRepositoryIdentity()` |

The rule is **equality with what was authorized**, not membership of a
workspace. RC3 did not turn SafeLoop into "shell always runs in the workspace"
or "git always operates on the initial repository":

| Authorized | At execution | Outcome |
| --- | --- | --- |
| cwd A | cwd A | execute |
| cwd A | cwd B | reject `cwd_context_changed` |
| repo A | repo A | execute |
| repo A | repo B | reject `repository_context_changed` |
| outside-workspace cwd, unchanged | same | execute — policy already approved it |
| any | unresolvable | reject `execution_context_verification_failed` |

### Why git binds two facts

Verifying the directory alone leaves a second door open: the same directory can
be made to reach a different repository through a replaced `.git`, a worktree
redirect, or `GIT_DIR`. Repository identity is taken from git's own plumbing
(`git rev-parse --absolute-git-dir`, then resolved), so worktrees and `.git`
files resolve the way git itself resolves them. A regression test swaps `.git`
while leaving the directory untouched, and it is refused.

### HTTP: redirects are not followed

`fetch` follows redirects by default. Under 307/308 the method and body are
preserved, so an authorization for host A delivered a `POST` — payload intact —
to host B, while SafeLoop's evidence still recorded host A. That is destination
substitution with a misleading audit trail.

Managed requests now use `redirect: 'manual'`. The redirect target is reported
(`redirect_not_followed`, `redirect_location`) rather than chased, so an agent
can propose the new destination and have it governed on its own terms.

**This is a deliberate behaviour change**: a managed request that would
previously have followed a redirect transparently now returns the 3xx. That is
the honest trade — a destination SafeLoop did not authorize is a destination
SafeLoop will not deliver to.

## Found by independent audit of the RC3 fix — binding the object, not the category

An independent audit of the RC3 remediation found the same defect surviving one
level below each guard that had just been added. Both are closed here.

### Filesystem: the resolved target is bound, not just its workspace relation

The permit bound the workspace *relation*, which is one bit. Two directories
that share it are interchangeable under it, so re-pointing a symlink anywhere in
a target's ancestry — including one directory below a correctly verified `cwd` —
moved the write into a sibling while containment, workspace root, and the newly
bound `cwd` all still verified.

The consequences were not limited to landing in the wrong sibling. A write
proposed against `<ws>/.ssh/authorized_keys` is refused outright by
`path.sensitive`; proposed through a symlink and then redirected, the same bytes
were delivered there under an auto-`ALLOW` permit. An operator-approved
outside-workspace write was likewise delivered to a different outside directory
with the approval still reading as satisfied.

The permit now signs `resolved_target` (and `resolved_destination` for moves),
produced by the same `verifyContainment` call the executor re-runs before the
syscall, so the two answers cannot be computed differently. Relation is still
checked first, so a genuine boundary crossing is still diagnosed as one.

### Git: HEAD is bound for operations that write

Repository identity answers *which repository*, never *which branch*, and
`git symbolic-ref HEAD refs/heads/release` does not touch the git directory. A
commit approved on one branch landed on a protected one inside the same
repository, in a plain checkout and in a linked worktree.

The permit now signs `head_ref` and `head_commit`. Both halves are needed:
checking out a branch that already sits on the commit a detached HEAD was
parked at leaves the commit equal while redirecting the commit onto that branch.
`git symbolic-ref HEAD` is used rather than `rev-parse --symbolic-full-name`
because it succeeds on an unborn branch and fails on a detached one, which makes
those two states distinguishable.

The check is conditional on the operation. Reads (`status`, `diff`, `log`,
`show`, `branch_list`, `remote_list`) and operations that touch neither HEAD nor
local refs (`fetch`, the `remote_*` family) are exempt, so a concurrent checkout
does not turn a legitimate read into a refusal. The exemption is expressed as a
list of what is *not* bound, so any operation added to the executor's template
table later is bound by default.

## Residual limitations — stated precisely

**Closed:** every demonstrated authorization→execution substitution above. Each
has a regression test asserting the side effect did not occur, and a conformance
check (C35 filesystem, C36 shell, C37 git, C38 HTTP) verified to fail
`NOT_CONFORMANT` when its guard is removed.

**Still open — small userspace check→use races.** Between verification and the
syscall a window remains. RC3 narrows it the same way RC2 did, by acting on the
resolved path rather than re-traversing the mutable one, but it does not
eliminate it. Doing so needs descriptor-relative syscalls (`openat2` with
`RESOLVE_BENEATH`, per-component `O_NOFOLLOW`, or spawning against a directory
file descriptor) that Node does not portably expose. **No claim of kernel-level
race elimination is made.**

**Shell is bound at its directory, not inside the process.** SafeLoop verifies
where a command starts. Once running, the process can `cd`, use absolute paths,
or open its own sockets. That has always been outside the routed-action
boundary and remains so — it is not process containment.

**HTTP is bound at the request SafeLoop issues.** SafeLoop is not a firewall and
does not intercept sockets. A process that opens its own connection is outside
the boundary.

**Same-UID trust boundary unchanged.** A process running as the same user can
read the `0600` credential and secret files.
