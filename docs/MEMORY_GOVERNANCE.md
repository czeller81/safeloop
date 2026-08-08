# Memory Governance

SafeLoop treats durable memory writes as governed actions. It does not replace the agent's memory framework.

The integration pattern is:

```text
Agent memory system
  -> candidate durable memory
  -> SafeLoop verification
  -> approved persistence, review, quarantine, or rejection
```

This is framework-neutral and can be used conceptually with Hermes self-learning, Malu-style memory sidecars, procedural experience tuples, AGENTS.md systems, memory graphs, vector memory, or custom sidecars. SafeLoop does not claim official compatibility with those systems unless an adapter is present.

## Candidate Memory

Before a durable memory write, the agent should submit a candidate:

```typescript
{
  memory_id: string;
  memory_type: string;
  source_task?: string;
  agent?: string;
  situation: string;
  action?: string;
  outcome?: string;
  lesson: string;
  confidence?: number;
  evidence?: string[];
  reuse_conditions?: string[];
  do_not_generalize?: boolean;
  tenant?: string;
  ttl?: string;
  created_at?: string;
  containsSensitiveData?: boolean;
}
```

## Decisions

`verifyCandidateMemory()` returns:

- `ALLOW`
- `ALLOW_WITH_TTL`
- `MERGE`
- `QUARANTINE`
- `REQUIRE_REVIEW`
- `REJECT`

Low-confidence, unsupported, sensitive, or over-generalized memories are not silently promoted to durable memory.

Current checks include confidence, supporting evidence, sensitive-data flags, `do_not_generalize`, and scenario memory-write policy. Contradiction detection, prompt-injection classification, and external fact verification are integration responsibilities unless supplied as evidence or policy context.

## Example

```typescript
import { verifyCandidateMemory } from 'safeloop';

const result = verifyCandidateMemory({
  memory_id: 'mem-001',
  memory_type: 'lesson',
  source_task: 'task-001',
  agent: 'hermes',
  situation: 'A local RAG answer was corrected by staff.',
  lesson: 'Prefer board-approved policy PDFs for attendance questions.',
  confidence: 0.92,
  evidence: ['artifact-policy-answer-review'],
  reuse_conditions: ['attendance policy questions'],
  tenant: 'district-001',
});

if (!result.allowed) {
  // Store in review/quarantine, not durable memory.
}
```

## Boundary

SafeLoop does not intercept private memory systems by itself. Memory sidecars and vector stores must call `verifyCandidateMemory()` before durable writes.

## Reference Persistence Pattern

The canonical memory integration pattern is:

1. Prepare a candidate memory or experience tuple.
2. Submit it to SafeLoop with `verifyCandidateMemory()` or the HTTP/Python client memory endpoint.
3. Treat the returned memory decision as binding.
4. Persist only `ALLOW` or `ALLOW_WITH_TTL`.
5. Keep `REJECT`, `QUARANTINE`, and `REQUIRE_REVIEW` out of durable memory.

SafeLoop includes `createGovernedMemoryAdapter()` as a reference implementation. It wraps a persistence adapter and writes only after SafeLoop returns an allowed memory decision.

```typescript
import { createGovernedMemoryAdapter, createInMemoryPersistenceAdapter } from 'safeloop';

const persistence = createInMemoryPersistenceAdapter();
const memory = createGovernedMemoryAdapter(persistence);

const decision = memory.write({
  memory_id: 'mem-1',
  memory_type: 'lesson',
  situation: 'A task completed successfully.',
  lesson: 'Retry transient failures once.',
  confidence: 0.9,
  evidence: ['artifact-1'],
});

if (!decision.allowed) {
  // Do not write to the durable memory store.
}
```

### Python Memory Systems

Python agents should use the thin client to ask the canonical SafeLoop engine before writing:

```python
from safeloop_client import SafeLoopClient

client = SafeLoopClient(bearer_token="local-secret")
decision = client.verify_memory({
    "memory_id": "mem-1",
    "memory_type": "lesson",
    "situation": "Task completed successfully",
    "lesson": "Retry transient failures once",
    "confidence": 0.9,
    "evidence": ["artifact-1"],
})

if decision["allowed"]:
    durable_memory_store.write(...)
```

### Hermes-Style Self-Learning

A Hermes-style learning loop should convert proposed lessons into candidate memories, call SafeLoop, and persist only allowed results. Quarantined or review-required lessons should go to a local review queue, not to the active memory graph.

### AGENTS.md / Markdown Memory

For Markdown memory systems, treat a proposed edit as a candidate durable memory. SafeLoop should verify the candidate before the file is edited. Rejected, quarantined, and review-required decisions should block the write.

### Vector Memory

For vector stores, run SafeLoop verification before embedding and insertion. This prevents rejected or quarantined content from entering the retrieval index.

---

# v0.2 — Memory Candidate Binding

## The gap this closes

v0.1 governed memory correctly but did not bind the decision to the bytes it
governed:

```
verifyCandidateMemory(A) → ALLOW → adapter persists B
```

Nothing tied the decision to the candidate that actually became durable. That is
the memory equivalent of TOCTOU, and it is the exact shape of a poisoning attack
that survives review: submit something innocuous, get approval, store something
else.

## The binding

```
MemoryCandidate
  → MemoryCandidateFingerprint      (SHA-256 over the meaning-bearing fields)
  → MemoryDecision
       ├── ALLOW / ALLOW_WITH_TTL / MERGE → MemoryPersistencePermit
       └── QUARANTINE / REQUIRE_REVIEW / REJECT → no permit at all
  → activation only for that exact candidate
  → MemoryProvenanceRecord
```

The permit is HMAC-signed, expiring, single-use, and bound to the candidate
fingerprint plus memory id, agent, task, and tenant. At persistence time the
fingerprint is **recomputed from the candidate being written right now** — never
from what was governed earlier.

### The binding set

Covered: `memory_id`, `memory_type`, `situation`, `action`, `outcome`, `lesson`,
`confidence`, `evidence`, `provenance`, `reuse_conditions`, `do_not_generalize`,
`tenant_id`, `agent_id`, `task_id`, `session_id`, `source_artifacts`,
`requested_ttl`, `contradicts`, `supersedes`, `contains_sensitive_data`.

Array fields are sorted before hashing, so evidence ordering is not
security-significant. `trace_id` and `created_at` are excluded, for the same
reason `trace_id` is excluded from action fingerprints.

## Preserved behaviour

The deterministic checks from `verifyCandidateMemory()` are reused **verbatim**,
including the governance-bypass detection hardened in `527785c`. v0.2 adds
binding; it does not reimplement memory policy. All six dispositions are
unchanged: `ALLOW`, `ALLOW_WITH_TTL`, `MERGE`, `QUARANTINE`, `REQUIRE_REVIEW`,
`REJECT`.

## Verified rejections

| Attack | Result |
| --- | --- |
| Modified lesson after authorization | `candidate_mismatch` |
| Modified situation | `candidate_mismatch` |
| Modified evidence | `candidate_mismatch` |
| Raised confidence | `candidate_mismatch` |
| Different tenant | `tenant_mismatch` |
| Different agent | `agent_mismatch` |
| Different task | `task_mismatch` |
| No permit | `missing_permit` |
| Forged permit signature | `forged` |
| Permit fingerprint claim edited | `forged` |
| Expired permit | `expired` |
| Replayed permit | `consumed` |
| Poisoned candidate (5 phrasings) | quarantined, never active |
| Quarantined / review-required / rejected candidate | never retrievable as active |

Every rejection also asserts that active memory did not gain the record.

## Provenance

`MemoryProvenanceRecord` answers *why does this agent remember this?* — memory
id, candidate fingerprint, originating agent and task, tenant, evidence and
artifact references, confidence, decision, timestamps, expiry, supersession,
contradictions, reuse conditions, `do_not_generalize`, and current status.

Provenance is recorded for quarantined and rejected candidates too, so a
reviewer can see what was refused and why — not only what was accepted.

## Lifecycle

`ACTIVE` · `QUARANTINED` · `REVIEW_REQUIRED` · `REJECTED` · `EXPIRED` ·
`SUPERSEDED`. Only `ACTIVE`, unexpired, same-tenant records are retrievable.
TTL expiry is applied on read, so a stale memory cannot be returned by a race.

## The reference store

`src/runtime/memoryStore.ts` exists to prove the architecture end to end and to
give conformance runs a store when a host agent's native memory is unavailable.

**It is not the preferred memory engine and is not marketed as one.** SafeLoop
governs memory; it does not need to replace specialized memory systems. A
production deployment should keep its own store and call
`authorizePersistence()` before activating anything.
