# Flight Recorder

SafeLoop Flight Recorder is the human-facing view over runtime work events, session work graphs, execution proofs, evidence records, artifacts, approval and permit IDs, and governed memory records. It is a read-only observability layer. It does not issue permits, change policy, approve actions, redeem approvals, or widen executor authority.

## What it shows

For each governed runtime session, the Flight Recorder projects:

- a session summary with task, tenant, agent, profile, duration, lifecycle counts, evidence counts, memory counts, and verification counts;
- a chronological timeline of normalized runtime work events;
- causal links between events, with missing links reported explicitly instead of fabricated;
- prevented actions such as deny, pause, stop-agent, approval denial, permit rejection, breaker block, budget block, and execution-context mismatch;
- execution proof summaries for filesystem, git, shell, HTTP, and MCP managed paths;
- evidence and artifact references by ID and hash;
- governed memory provenance, including candidate, decision, source session/task, evidence IDs, artifact IDs, and active or rejected status;
- governance coverage for observed consequential path families.

## CLI

Use:

```bash
safeloop session inspect <session_id>
```

The text view now includes a Flight Recorder section with summary counts, prevented actions, execution verification status, memory provenance, governance coverage, and explicit proof limitations.

Use JSON for automation:

```bash
safeloop session inspect <session_id> --json
```

The JSON response remains additive. The original session work graph is still present, with `flight_recorder` added as a read-only projection.

## Runtime API

All endpoints require the runtime bearer credential. Endpoints that read a session also require the credential for that exact session; a credential for one session cannot inspect another session.

Read-only endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/sessions` | List Flight Recorder session summaries visible to the supplied session credential. |
| `POST /v1/session/summary` | Return one session summary. |
| `POST /v1/session/timeline` | Return the bounded session work-event page. |
| `POST /v1/session/prevented` | Return prevented actions for one session. |
| `POST /v1/session/evidence` | Return execution proof, evidence, and artifact summaries. |
| `POST /v1/session/memory` | Return governed memory provenance for one session. |
| `POST /v1/session/export` | Return a safe JSON export bundle. |

`/v1/sessions` paginates only over sessions owned by the supplied session credential. Its counts do not include other sessions.

## Monitor UI

The local monitor dashboard includes a Flight Recorder panel. It lists recent governed sessions, core counters, verification distribution, and a direct CLI command for deeper inspection.

The monitor panel is an operator summary, not an approval surface. It does not grant approvals, redeem tokens, execute actions, or alter runtime state.

## Export boundary

`/v1/session/export` returns structured JSON with these explicit limits:

- `includes_file_bodies: false`
- `includes_full_process_output: false`

Exported data is redacted through the runtime work-event redaction path. It contains IDs, hashes, status, summaries, bounded proof metadata, and provenance links. It does not include full file contents, raw credentials, authorization headers, complete stdout/stderr, or hidden model reasoning.

## Proof semantics

Flight Recorder proof summaries preserve executor-specific boundaries:

- Filesystem proof covers directly observed state at the resolved target path. Hashes exist only when content was actually hashable within the evidence cap.
- Git proof covers observed repository state before and after the governed git invocation. It does not include full diff bodies.
- Shell proof verifies the governed process invocation and result. It does not prove every downstream process side effect.
- HTTP proof covers the transaction SafeLoop made. It does not prove the remote business outcome.
- MCP proof covers the call and result SafeLoop observed. It does not prove downstream side effects performed by the remote MCP server.

SafeLoop governs routed managed execution paths. Activity outside those routed paths is outside the Flight Recorder proof boundary.

## Enforcement boundary

Flight Recorder is intentionally evidence-side only. It consumes existing runtime records and does not change:

- policy evaluation;
- risk scoring;
- approval requirements;
- approval redemption;
- permit issuance or consumption;
- breaker or budget enforcement;
- execution-context binding;
- managed executor authorization;
- memory authorization.

`ENFORCEMENT_SEMANTICS_CHANGED: NO`
