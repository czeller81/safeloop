# Evidence And Provenance

SafeLoop separates evidence from unsupported agent conclusions.

## Verification Statuses

- `VERIFIED_FACT`: verified against an artifact or trusted verification path.
- `OBSERVATION`: directly observed but not yet promoted to verified fact.
- `INFERENCE`: reasoned from available evidence.
- `ASSUMPTION`: accepted temporarily without enough verification.
- `SPECULATION`: weak or uncertain claim.
- `UNVERIFIED`: no verification status yet.

## Promotion Rules

SafeLoop does not allow unsupported evidence promotion:

```text
INFERENCE      -X-> VERIFIED_FACT
ASSUMPTION     -X-> VERIFIED_FACT
SPECULATION    -X-> VERIFIED_FACT
UNVERIFIED     -X-> VERIFIED_FACT
OBSERVATION     -> VERIFIED_FACT only with artifact verification
```

`promoteEvidence()` enforces valid promotion paths. `verifyArtifactHash()` checks artifact content against a SHA-256 hash.

## Artifact Hashing

```typescript
import { computeArtifactHash, promoteEvidence } from 'safeloop';

const content = 'approved source artifact';
const artifactHash = computeArtifactHash(content);

const result = promoteEvidence({
  evidenceId: 'evidence-001',
  currentStatus: 'OBSERVATION',
  targetStatus: 'VERIFIED_FACT',
  reason: 'Operator verified artifact content',
  verifiedBy: 'operator-1',
  artifactHash,
  actualArtifactContent: content,
});

if (!result.allowed) {
  // Keep the prior verification status.
}
```

If the artifact content changes, the computed hash changes and promotion fails.

## Evidence Registry

SafeLoop includes a lightweight local evidence registry abstraction:

- `createLocalEvidenceRegistry()`
- stable `evidenceId`
- SHA-256 artifact hash
- provenance record
- verification status
- later re-verification
- tamper/replacement detection

The registry is intentionally small and local-first. It can later be replaced by a database-backed or externally verified registry without changing the evidence semantics.

```typescript
import { createLocalEvidenceRegistry } from 'safeloop';

const registry = createLocalEvidenceRegistry({ baseDir: '.safeloop-demo' });
const record = registry.register({
  evidenceId: 'evidence-1',
  content: 'artifact content',
  provenance: evidenceRecord,
});

const check = registry.verify(record.evidenceId, 'artifact content');
```

## Current Limitations

SafeLoop provides artifact hashing, promotion-path governance, and a lightweight local evidence registry. It does not yet provide external verifier adapters or cryptographic signing of evidence records.
