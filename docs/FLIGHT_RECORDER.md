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
| `POST /v1/session/prevented` | Return prevented actions, prevention conflicts, and graph diagnostics for one session. |
| `POST /v1/session/evidence` | Return execution proof, evidence, and artifact summaries. |
| `POST /v1/session/memory` | Return governed memory provenance for one session. |
| `POST /v1/session/export` | Return a safe JSON export bundle. |

`/v1/sessions` paginates only over sessions owned by the supplied session credential. Its counts do not include other sessions.

## Monitor UI

The local monitor dashboard includes a Flight Recorder panel. It lists recent governed sessions, core counters, verification distribution, and a direct CLI command for deeper inspection.

The monitor panel is an operator summary, not an approval surface. It does not grant approvals, redeem tokens, execute actions, or alter runtime state.

## Privacy and redaction

Flight Recorder-facing projections redact data before API, CLI, UI, and export surfaces receive it. Work-event data, execution proof metadata, evidence supported claims, artifact metadata, and governed memory provenance are treated as untrusted display data and are copied through a redacted projection rather than returned directly from storage.

Redaction is best-effort over configured structured fields and known secret-shaped strings such as bearer tokens, API-key-like values, password/passwd/api key/client secret/private key/credential/authorization/operator assignments, AWS secret access-key assignments, private-key markers, URL userinfo credentials, and SafeLoop test canaries. Assignment redaction preserves non-secret path structure, so `/tmp/password=secret/report.txt` is projected as `/tmp/password=[REDACTED]/report.txt` rather than losing `/report.txt`. It is not a guarantee that every possible secret format can be recognized, so adapters should still avoid writing raw secrets to the ledger.

## Export boundary

`/v1/session/export` returns structured JSON with these explicit limits:

- `includes_file_bodies: false`
- `includes_full_process_output: false`

Exported data is redacted through the Flight Recorder projection boundary. It contains IDs, hashes, status, summaries, bounded proof metadata, and provenance links. It does not include full file contents, raw credentials, authorization headers, complete stdout/stderr, or hidden model reasoning. Freeform evidence claims and artifact paths may be partially redacted when they contain secret-shaped components. Historical ledger records are not rewritten for privacy; redaction is applied at projection time.

## Prevented-action semantics

A prevented action means SafeLoop governance or executor admission blocked a protected side effect and no linked execution record indicates that the protected execution occurred. The projection uses recorded identifiers such as proposal IDs, decision IDs, approval IDs, permit IDs, execution IDs, action fingerprints, and causal event IDs where available. It does not use text matching.

If records say both that governance blocked an action and that a linked execution occurred afterward, the Flight Recorder reports an inconsistent record instead of counting the action as prevented. `/v1/session/prevented` includes these records in `prevention_conflicts` alongside `prevented_actions` so API consumers do not see a clean-looking prevented list when contradictory execution evidence exists. Historical data is not rewritten; the contradiction remains visible for review. If a linked execution happened before a later block, the projection does not treat that as a contradiction. If timestamps are missing or identical, the record is surfaced with unknown temporal certainty rather than converted into a definitive conflict.

Each prevented action includes additive execution certainty. `execution_status: not_observed` means no linked protected execution was recorded with sufficient causal evidence. `execution_status: observed` is used for linked execution evidence. `execution_status: unknown` is used when dangling or missing causal references, identical timestamps, or incomplete linkage prevent a definitive assertion. The legacy `execution_occurred` boolean remains for compatibility and should be read as whether linked execution was observed in the current projection, not as proof that execution was impossible.

Execution failures after a process/request/tool call ran are not counted as prevented actions. Examples include shell non-zero exit, HTTP 500 after the request was sent, MCP failed result after the call, or verification failure after execution.

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
