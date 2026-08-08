# SafeLoop Runtime Protocol — `safeloop.runtime.v1`

The normative definition of the protocol is the JSON Schema set in
`protocol/schemas/`. `src/runtime/protocol.ts` is a TypeScript *projection* of
those schemas and carries no semantics they do not express.

> SafeLoop can be implemented in TypeScript.
> SafeLoop cannot be dependent on TypeScript.

Every consequential structure is plain JSON — no classes, no `Date`, no `Map`,
no functions. A conforming client in any language can produce and consume them.

## Version

| Field | Value |
| --- | --- |
| Protocol version | `safeloop.runtime.v1` |
| Runtime version | `0.2.0` |
| Hash algorithm | SHA-256 |
| Signature algorithm | HMAC-SHA256 |

Every schema declares `protocolVersion`, and a test asserts all of them agree.
A payload whose `protocol_version` does not match is rejected as forged rather
than accepted leniently.

## Schemas

26 schemas in `protocol/schemas/`:

| Group | Schemas |
| --- | --- |
| Identity & context | `agent-identity`, `session-context`, `task-context`, `scenario-context` |
| Actions | `action-proposal`, `canonical-action`, `action-fingerprint`, `governance-decision` |
| Approvals | `approval-request`, `approval-grant`, `approval-token`, `approval-redemption` |
| Execution | `execution-permit`, `execution-request`, `execution-result` |
| Memory | `memory-candidate`, `memory-candidate-fingerprint`, `memory-decision`, `memory-persistence-permit`, `memory-provenance-record` |
| Evidence | `evidence-record`, `artifact-record`, `runtime-event` |
| Operations | `managed-path-declaration`, `runtime-health`, `conformance-result` |

Validation uses a zero-dependency subset validator (`src/runtime/schemaValidator.ts`).
SafeLoop deliberately does not pull a general JSON Schema library into its
trusted path. A test enumerates every keyword used across every schema and fails
if one appears that the validator does not implement, so the subset can never
drift into silently under-validating.

## Canonical actions and fingerprints

An `ActionProposal` is what an agent asks for. A `CanonicalAction` is its
deterministic normalized form. An `ActionFingerprint` is SHA-256 over the
canonical serialization, and it is the identity that approvals and permits bind
to.

Determinism rules:

1. Object keys are sorted by UTF-16 code unit before serialization. JS object
   iteration order is never relied upon.
2. Arrays keep their order — `["npm","test"]` is not `["test","npm"]`.
3. Absent, `null`, and empty-string collapse to one canonical empty form, so an
   adapter cannot produce two spellings of "nothing".
4. Case is lowered **only** on case-insensitive protocol slots: `action_kind`,
   `tool`, `operation`, `method`. Never on arguments, paths, targets, or
   resources — `/Data` and `/data` are different files on a case-sensitive
   filesystem, and `--Force` is not `--force`.
5. `cwd` is lexically normalized (separator handling, `.`/`..` resolution)
   because `/a/b/../c` and `/a/c` are the same directory. Symlinks are **not**
   resolved here: that would make the fingerprint depend on mutable host state.
   Symlink resolution belongs to workspace classification, where it is applied.

### The binding set

The fingerprint covers: `protocol_version`, `action_kind`, `tool`, `operation`,
`arguments`, `cwd`, `target`, `resource`, `method`, `agent_id`,
`parent_agent_id`, `task_id`, `session_id`, `scenario_id`, `tenant_id`.

`trace_id` is deliberately **excluded**. An approval requested under one trace
must stay redeemable by the execution that follows it; including trace lineage
would break every real approval flow while adding no security.

`metadata` is also excluded: it is adapter free-form and must never be able to
change an action's identity.

## Lifecycle

```
ActionProposal
  → CanonicalAction → ActionFingerprint
  → GovernanceDecision
       ├── ALLOW / ALLOW_WITH_WARNING → ExecutionPermit
       ├── REQUIRE_APPROVAL           → ApprovalRequest
       │                                 → ApprovalGrant (BoundApprovalToken)
       │                                 → ApprovalRedemption → ExecutionPermit
       └── DENY / STOP_AGENT / PAUSE  → no permit
  → ExecutionRequest (permit + exact action)
  → ExecutionResult → EvidenceRecord / ArtifactRecord / RuntimeEvent
```

Memory follows the same shape:

```
MemoryCandidate
  → MemoryCandidateFingerprint
  → MemoryDecision
       ├── ALLOW / ALLOW_WITH_TTL / MERGE → MemoryPersistencePermit
       └── QUARANTINE / REQUIRE_REVIEW / REJECT → no permit
  → durable activation of that exact candidate → MemoryProvenanceRecord
```

## Transports

| Transport | Availability | Notes |
| --- | --- | --- |
| localhost HTTP | all platforms | `127.0.0.1` only; no option to widen the bind |
| Unix domain socket | Linux / macOS | inside a `0700` directory in the runtime state dir |
| MCP stdio | all platforms | existing SafeLoop MCP server |
| CLI stdin JSON | all platforms | `safeloop governance evaluate --stdin` |
| Windows named pipe | not implemented | `RuntimeHealth.transport` is a list, so adding one needs no protocol change |

Linux/WSL is the first certified platform.

## HTTP surface

All routes except `/health` require the runtime bearer credential. All routes
carrying identity additionally require a session credential in the body.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness; unauthenticated by design |
| GET | `/v1/status` | runtime and session state |
| POST | `/v1/session/start` | establish identity; returns a session credential |
| POST | `/v1/session/finish` | close a session |
| POST | `/v1/task/start` | begin a task |
| POST | `/v1/task/finish` | end a task |
| POST | `/v1/action/propose` | govern an action; returns a decision |
| POST | `/v1/approval/grant` | human grants a held request |
| POST | `/v1/approval/redeem` | redeem a bound token for a permit |
| POST | `/v1/action/execute` | execute under a permit |
| POST | `/v1/memory/propose` | govern a memory candidate |
| POST | `/v1/memory/persist` | activate an authorized candidate |
| POST | `/v1/memory/active` | retrieve active memory for the tenant |

Errors return `{ "error": "<code>", "message": "..." }` with codes such as
`unauthenticated`, `identity_substitution`, `privilege_widening`,
`unknown_session`, and `session_finished`.

## Compatibility

`safeloop.runtime.v1` is additive alongside the v0.1 surfaces in `schemas/`,
which remain unchanged. Existing CommandGuard, MCP, and monitor flows are
untouched.
