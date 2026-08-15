# Operator Observability

SafeLoop operator observability is a read-only dashboard and API layer over the Flight Recorder projection. The dashboard is an observability surface and does not make governance decisions.

## Architecture

The read path is:

```text
governed runtime events
  -> immutable historical record
  -> session work graph
  -> Flight Recorder projection
  -> projection-time redaction
  -> observability read model / API
  -> monitor UI
```

The UI does not query raw ledger records when a Flight Recorder projection exists. It groups and renders already-projected facts; it does not decide whether an action was allowed, blocked, executed, prevented, conflicted, or verified.

## Session Browser

The monitor lists authorized session summaries with session ID, task or goal, start/latest timestamps, event count, execution count, prevented count, conflict count, uncertainty count, evidence count, memory count, tenant/agent context, and verification summary. Search and filters operate on redacted session card metadata and rendered redacted text only.

Available filters include executed, prevented, conflict, unknown, evidence, artifact, approval, permit, breaker, and budget. Filtering is an operator convenience and does not change the projection or authorization boundary.

## Causal Graph

The causal work graph uses recorded references only:

- `parent_event_id`
- `causes`
- recorded evidence IDs
- recorded artifact IDs
- recorded memory candidate IDs
- recorded execution proof IDs

Visual adjacency is not causal unless a recorded edge exists. SafeLoop does not connect graph nodes merely because they share a session, task, timestamp proximity, similar text, or similar artifact path. Dangling references are shown as missing-reference nodes. If malformed historical data contains a cycle, the read model reports the anomaly instead of rewriting history.

## Timeline

The timeline is chronological and shows event type, timestamp, event ID, summary, explanation, recorded links, missing links, refs, and redacted payload detail. Expansion controls expose details without bypassing projection-time redaction.

## Prevention, Conflicts, And Unknowns

Prevented actions keep Phase 3.1 semantics:

- `PREVENTED` means governance or executor admission blocked a protected side effect and no linked protected execution was observed.
- `CONFLICT` means a block/deny has linked later execution evidence.
- `UNKNOWN` means missing or incomplete causal evidence prevents a definitive assertion.

Failed executions, HTTP 500 responses after an allowed request, MCP failed results, and verification failures after execution are execution/proof outcomes, not prevention.

## Evidence, Artifacts, Proof Limits

Evidence and artifacts are displayed through the redacted Flight Recorder projection. Proof limitations are visible for filesystem, git, shell, HTTP, and MCP execution paths. A successful process or transaction does not imply a downstream business outcome unless recorded evidence supports that claim.

## Redaction And Isolation

Projection-time redaction remains authoritative. The dashboard does not add an unredacted cache or index. Search/filter metadata is derived from redacted projection fields. Runtime Flight Recorder APIs require the runtime bearer credential plus the credential for the requested session; unauthorized requests are rejected before graph/evidence materialization.

## Current Limitations

- Secret recognition is best-effort.
- The dashboard governs only what SafeLoop recorded for routed/managed execution paths.
- Large sessions are bounded for browser usability; deep review should use paginated API endpoints and CLI JSON.
- Unknown causal ordering remains unknown when timestamps or references are insufficient.