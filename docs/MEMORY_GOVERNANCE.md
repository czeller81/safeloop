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
