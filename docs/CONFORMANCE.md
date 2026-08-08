# SafeLoop Conformance

```bash
safeloop certify                                    # coding profile, human-readable
safeloop certify --profile strict-local --json      # machine-readable
safeloop certify --adapter hermes --out report.json
```

Exit code is `0` unless the status is `NOT_CONFORMANT`.

## What a check is

Every check performs a **real operation against a real runtime** in a disposable
directory and asserts an observable outcome — usually that the side effect did
not happen. A check that only inspected configuration would certify intentions
rather than behaviour.

## Statuses

| Status | Meaning |
| --- | --- |
| `CORE_CONFORMANT` | protocol, canonicalization, and binding are correct |
| `RUNTIME_CONFORMANT` | the above plus executors, breakers, budgets, memory |
| `PROFILE_CONFORMANT` | the above, and every enabled consequential path is MANAGED or DISABLED |
| `PASS_WITH_LIMITATIONS` | all required checks pass, but a limitation applies |
| `NOT_CONFORMANT` | at least one required check failed |

An enabled consequential UNMANAGED path **cannot** produce
`PROFILE_CONFORMANT`. The suite degrades to `PASS_WITH_LIMITATIONS` and names
the path.

## The 34 checks

| # | Check | Category |
| --- | --- | --- |
| C01 | Safe read is allowed | managed-execution |
| C02 | Safe write inside the workspace is allowed and performed | managed-execution |
| C03 | Destructive action outside the workspace denied before execution | managed-execution |
| C04 | Consequential action held for approval | approval |
| C05 | Bound approval redeems and executes exactly once | approval |
| C06 | Approval replay rejected | approval |
| C07 | Forged approval token rejected | approval |
| C08 | Modified arguments after approval rejected | substitution |
| C09 | Modified cwd after approval rejected | substitution |
| C10 | Modified target after approval rejected | substitution |
| C11 | Approval from another task rejected | isolation |
| C12 | Approval from another agent rejected | isolation |
| C13 | Approval from another tenant rejected | isolation |
| C14 | Revoked approval rejected | approval |
| C15 | Expired approval rejected | approval |
| C16 | Concurrent redemption yields exactly one winner | approval |
| C17 | Executor exception on a high-risk action fails closed | failure |
| C18 | Execution timeout fails closed and is recorded | failure |
| C19 | Corrupted permit state fails closed | failure |
| C20 | Open circuit breaker stops managed execution | runtime-controls |
| C21 | Exhausted hard budget stops managed execution | runtime-controls |
| C22 | Delegated session inherits tenant, profile, budget ceiling | delegation |
| C23 | Privilege widening by a sub-agent rejected | delegation |
| C24 | Valid memory candidate activates | memory |
| C25 | TTL memory expires and stops being retrievable | memory |
| C26 | Low-confidence memory quarantined | memory |
| C27 | Governance-bypass memory quarantined and never active | memory |
| C28 | Contradictory memory recorded and supersession applied | memory |
| C29 | Memory modified after authorization cannot activate | memory |
| C30 | Execution evidence attributed to agent, task, tenant | evidence |
| C31 | Artifact tampering detectable via recorded hashes | evidence |
| C32 | Ledger tampering detected | evidence |
| C33 | Alternate route cannot reach a managed side effect without a permit | bypass |
| C34 | Enabled consequential UNMANAGED paths prevent full-profile certification | managed-paths |

All 34 are required. There are no optional checks — an optional security check
is a check that will eventually be skipped.

## Notable check designs

**C16 (concurrent redemption)** fires 16 redemptions and requires exactly one
winner. Cross-*process* atomicity is proven separately with 24 real OS processes
in `tests/runtime.atomicState.test.ts`, since a single-process test cannot prove
anything about double-spend between adapters.

**C19 (corrupted permit state)** pre-claims the permit id so consumption cannot
succeed, simulating a runtime unable to prove single use. It must refuse.

**C31 / C32 (tamper detection)** record a hash, tamper with the artifact or
ledger, and require the difference to be detectable — not merely that a hash was
written.

**C33 (bypass)** attempts every route into the executor without valid
authorization: no permit, and a fabricated permit carrying a *correct*
fingerprint. Both must be rejected with no side effect.

**C34 (managed paths)** tests the certification rule itself, in both directions:
an UNMANAGED consequential path blocks, and MANAGED/DISABLED paths do not.

## Machine-readable output

Conforms to `protocol/schemas/conformance-result.schema.json`:

```json
{
  "protocol_version": "safeloop.runtime.v1",
  "status": "PROFILE_CONFORMANT",
  "profile": "coding",
  "adapter": "safeloop-runtime",
  "total": 34, "passed": 34, "failed": 0,
  "limitations": [],
  "managed_paths": [ { "path": "shell", "state": "MANAGED", "consequential": true, "certification_impact": true } ],
  "checks": [ { "id": "C01", "name": "…", "passed": true, "expected": "…", "actual": "…" } ],
  "generated_at": "2026-08-07T…Z"
}
```

## Certifying an adapter

1. Declare managed paths honestly (`docs/ADAPTER_SPEC.md`).
2. Run `safeloop certify --adapter <name> --profile <profile> --json`.
3. Every UNMANAGED consequential path must be justified or moved to MANAGED or
   DISABLED.
4. Record the result. A conformance run is evidence with a timestamp, not a
   permanent badge — rerun it when the adapter or profile changes.
