# Memory Governance

SafeLoop treats durable memory writes as governed actions.

This is framework-neutral and can be used by Hermes, Malu, PlugMem-style tuple stores, AGENTS.md systems, memory graphs, vector memory, or custom sidecars.

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
