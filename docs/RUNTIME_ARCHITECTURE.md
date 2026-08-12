# SafeLoop v0.2 Runtime Architecture

> Git tracks code. SafeLoop tracks and governs agent work.

SafeLoop is a **local runtime governance layer for autonomous AI agents**. It
evaluates and controls agent actions, approvals, memory, budgets, evidence, and
configured managed execution paths routed through the SafeLoop runtime.

## The lifecycle

```
THINK → PROPOSE → GOVERN → APPROVE IF REQUIRED → EXECUTE
      → VERIFY → PROVE → LEARN → GOVERN MEMORY → REMEMBER
```

## Action architecture

```
Agent
  → SafeLoop adapter / SDK
  → SafeLoop runtime          (canonicalize, fingerprint, decide)
  → governance decision
  → SafeLoop managed executor (verify permit, consume, admit)
  → the actual side effect
  → evidence + ledger
```

The pattern v0.2 removes:

```
SafeLoop says "allowed" → agent independently performs an arbitrary later action
```

For every managed path, the thing that decides and the thing that acts are the
same thing.

## Memory architecture

```
Agent experience / candidate memory
  → SafeLoop memory governance   (fingerprint, deterministic checks)
  → binding memory decision      (persistence permit or nothing)
  → authorized durable persistence
     → optional SafeLoop reference/local store
     → external or native agent memory store
  → provenance record
```

## Module map

```
protocol/schemas/           normative JSON Schema (26 files)
src/runtime/
  protocol.ts               TypeScript projection of the schemas
  schemaValidator.ts        zero-dependency subset validator
  canonicalAction.ts        deterministic canonicalization + SHA-256
  runtimeSecret.ts          0600 signing secret; never emitted
  atomicStateStore.ts       exclusive-create single-use claims
  boundApproval.ts          approval requests, grants, redemption
  executionPermit.ts        permit issue / verify / consume
  budgets.ts                budgets as admission control
  workspace.ts              containment + sensitive-path classification
  profiles.ts               generic rule matcher over profile data
  managedExecutor.ts        the choke point
  executors/{shell,filesystem,git,http,mcp}.ts
  memoryGateway.ts          candidate fingerprints + persistence permits
  memoryStore.ts            reference governed store + provenance
  recorder.ts               bridge to evidence registry and ledger
  workEvents.ts             schema-versioned causal work-event envelope
  sessionWorkGraph.ts       read-only per-session graph projection
  runtimeCore.ts            sessions, identity, tasks, decisions
  runtimeAuth.ts            two-layer local credentials
  daemon.ts                 loopback HTTP + unix socket
  client.ts                 TypeScript SDK
  conformance.ts            profile conformance certification suite
  cliCommands.ts            daemon / run / status / certify / init
profiles/*.profile.json     coding, research, assistant, strict-local
python/safeloop_client/runtime.py   Python adapter SDK
```

Concerns stay separated: protocol, canonicalization, identity, policy, risk,
approvals, runtime state, transports, executors, memory, SDKs, profiles,
conformance, telemetry. There is no god class.

## What was reused, not rebuilt

v0.2 adds a runtime around working machinery rather than replacing it:

| Existing | Role in v0.2 |
| --- | --- |
| `evaluateRuntimePolicy()` | still the risk engine; called by `runtimeCore.propose` |
| `verifyCandidateMemory()` | still the memory checks, including the 527785c poisoning fix |
| `createRuntimeCircuitBreaker()` | wrapped as an executor admission gate |
| `createLocalEvidenceRegistry()` | still the evidence store |
| `eventStream` + `ledgerIntegrity` | still the ledger and its seal/verify |
| `createCommandGuard()` | unchanged; the v0.1 flow still works |
| MCP gateway and stdio server | unchanged |

Profile rules and the risk engine combine **most-severe-wins**. Neither can
loosen the other.

## Decision flow

```
propose(credential, session_id, task_id, action)
  authenticate                      → credential must belong to this session
  bindIdentity                      → agent/tenant/task/session/scenario come
                                      from the session record, not the caller
  canonicalize + fingerprint
  evaluateProfile                   → deterministic rules over structural facts
  evaluateRuntimePolicy             → risk dimensions
  moreSevere(profile, risk)         → final disposition
  breaker.evaluate
  ALLOW/WARNING  → issue ExecutionPermit
  REQUIRE_APPROVAL → create ApprovalRequest
  DENY/STOP/PAUSE  → no permit
  record event
```

An LLM is never the policy enforcer. Enforcement is deterministic rules, then
risk evaluation, then a binding SafeLoop decision, then human approval where
required, then exact execution.

## Identity

After a session is established the caller cannot change who it is. `propose`
overwrites `agent_id`, `parent_agent_id`, `task_id`, `session_id`,
`scenario_id`, and `tenant_id` from the runtime's own session record. An agent
claiming to be another tenant is not trusted to be telling the truth about which
tenant it is.

Delegation inherits exactly: tenant, scenario, and profile must match the
parent, and the child's budgets are capped at the parent's *remaining* budget.
Any widening attempt raises `privilege_widening`.

## Authentication

Two layers:

- **Runtime credential** — may you talk to this daemon at all? A `0600`
  connection file in the runtime state directory; possession is the trust
  boundary, like a Docker socket.
- **Session credential** — which session are you acting inside? Issued by
  `startSession`, bound to one session.

Holding the runtime credential is not enough to act inside a session you did not
start. Absent and incorrect credentials receive byte-identical responses.

## Performance

The v0.1 Hermes adapter spawned `node dist/cli.js` per governed tool call —
roughly 150ms of Node startup before any policy ran. Governance that costs that
much per action gets switched off, so the resident daemon exists as much for
adoption as for architecture. In-process decisions are sub-millisecond; the
full conformance suite (34 checks, each doing real I/O) runs in about two
seconds.

Runtime state has cleanup semantics: claim records carry expiry and `prune()`
drops them, except corrupt records, which are retained because deleting them
would convert a corruption into a replay opportunity.


## Work graph observability

The runtime records a causally linkable `metadata.workEvent` alongside legacy
ledger events. This adds proposal, decision, approval, permit, execution,
verification, evidence, artifact, and memory references without changing the
legacy event stream contract.

`buildSessionWorkGraph(session_id)` is a read-only projector over those records.
It joins runtime work events with evidence, artifact, and governed memory records
so a session can be inspected as a timeline or as causal edges. The CLI surface is
`safeloop session inspect <session_id> [--json]`; the daemon surface is
`POST /v1/session/timeline`.

The work graph is observability, not enforcement. Denials, approvals, permit
signatures, one-time redemption, budget checks, circuit breakers, and executor
admission remain the enforcement path.

## Boundary

SafeLoop governs actions routed through SafeLoop-managed execution paths.

It is **not** a kernel security module, EDR, antivirus, firewall, IAM system,
universal syscall interceptor, arbitrary process container, OS sandbox, or a
guarantee that AI is correct or safe.

Enabled consequential paths must be MANAGED or DISABLED. Unmanaged host
processes require external controls: OS permissions, containers, network policy,
IAM, endpoint protection, secrets management.

See `docs/THREAT_MODEL.md` and `docs/MANAGED_EXECUTION.md`.
