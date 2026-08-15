# Runtime Event Model

SafeLoop keeps the existing ledger schema intact:

```typescript
{
  id: string;
  type: string;
  timestamp: string;
  agentId: string;
  agentName?: string;
  participantId?: string;
  caseId?: string;
  sessionId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}
```

The runtime governance layer adds a normalized TypeScript model on top of this shape. It stores normalized fields in `metadata` when events are written to the ledger, so existing readers remain compatible.

## Canonical Runtime Event Types

- `task.started`, `task.completed`, `task.failed`
- `agent.started`, `agent.paused`, `agent.resumed`, `agent.stopped`
- `decision.proposed`, `decision.recorded`
- `tool.requested`, `tool.allowed`, `tool.denied`, `tool.executed`, `tool.failed`
- `risk.detected`, `risk.cleared`
- `policy.evaluated`, `policy.passed`, `policy.failed`
- `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`
- `artifact.created`, `artifact.modified`, `artifact.deleted`
- `external_action.requested`, `external_action.executed`
- `memory.write.requested`, `memory.write.allowed`, `memory.write.quarantined`, `memory.write.rejected`
- `handoff.created`, `handoff.accepted`
- `circuit_breaker.triggered`, `circuit_breaker.cleared`

## Normalized Fields

Runtime events may carry:

- identity: `event_id`, `agent_id`, `agent_name`, `agent_type`, `user_id`, `tenant_id`
- execution context: `task_id`, `session_id`, `trace_id`, `parent_event_id`
- model context: `model`, `provider`
- proposed effect: `tool`, `action`, `target`, `arguments_hash`
- policy result: `policy_ids`, `decision`, `decision_reason`, `approval_id`
- risk: `risk_score`, `risk_dimensions`, `confidence`
- proof: `evidence_ids`, `artifact_ids`, `provenance`
- accountability: `cost`, `token_usage`, `latency`
- extensions: `metadata`


## Runtime Work Events

Phase 1 adds a causally linkable work-event envelope without changing the
legacy ledger top-level shape. A legacy event may now include
`metadata.workEvent`, whose schema is `protocol/schemas/runtime-work-event.schema.json`.
The work event is read-only observational metadata; enforcement still comes from
runtime decisions, permits, approval redemption, and managed execution.

Each work event carries:

- `protocol_version` and `event_schema_version` (`1` for this schema)
- stable event identity: `id`, `type`, `timestamp`, `session_id`
- optional work identity: `task_id`, `agent_id`, `tenant_id`
- causal references: `parent_event_id` and `causes`, which refer only to `RuntimeWorkEvent.id` values
- lifecycle references: proposal, decision, approval request, approval, permit,
  execution, verification, evidence, artifact, and memory IDs
- redacted `summary` and `data`

The normalized lifecycle event names are:

- `session.started`, `session.completed`
- `task.started`, `task.completed`, `task.failed`
- `proposal.recorded`, `decision.recorded`
- `approval.requested`, `approval.granted`, `approval.denied`, `approval.redeemed`
- `permit.issued`, `permit.consumed`
- `execution.started`, `execution.completed`, `execution.rejected`
- `verification.recorded`
- `evidence.recorded`, `artifact.recorded`
- `memory.candidate.recorded`, `memory.decision.recorded`, `memory.persisted`, `memory.rejected`

`metadata.workEvent` is deliberately optional. Readers must tolerate older
ledger records that do not have work-event metadata, and writers must continue
emitting ordinary legacy events so dashboards, audit export, and existing tools
remain compatible.

## Session Work Graph

`buildSessionWorkGraph(session_id)` projects one session into a causal graph. It
joins work events with evidence registry records, runtime artifact records, and
reference memory-store records. The graph preserves object-level causal edges,
including proposal-to-decision, approval-to-permit, permit-to-execution,
execution-to-evidence/artifact, and memory candidate-to-decision/persistence
references.

Inspection surfaces are read-only:

- CLI: `safeloop session inspect <session_id> [--json] [--baseDir <path>]`
- Daemon: `POST /v1/session/timeline` with `{ "session_id": "...", "credential": "...", "limit": 250, "cursor": "..." }`


Timeline daemon reads are session-scoped. The caller must hold the runtime
credential and must also provide the session credential for the requested
`session_id`. A runtime credential alone is not timeline authority, and a
credential for one session cannot inspect another session, including across
tenants.

Daemon timeline responses are paginated. The default limit is 250 work events
and the hard maximum is 1000. `cursor` is the last work-event ID returned by the
previous page. Responses include `page.has_more`, `page.next_cursor`,
`page.total_count`, and `page.returned_count`. Raw legacy events are excluded by
default; callers may request `include_legacy_events: true`, and embedded
`metadata.workEvent` payloads are stripped from those legacy records to avoid
returning the same work event twice.

Graph edge semantics are strict: `parent_event_id` and internal `causes` point to
work-event IDs, not proposal IDs, approval IDs, permit IDs, execution IDs, or
memory IDs. Domain object IDs remain available in their dedicated fields. Clean
new sessions should report `dangling_internal_edge_count: 0`; historical or
external references are reported separately rather than silently dropped.

`permit.consumed` means the one-time permit was successfully redeemed by the
managed executor. It does not mean execution began and does not prove a side
effect occurred. Consumers must look for `execution.started`,
`execution.completed`, and verification/evidence events to prove execution. A
breaker or budget block may occur after a permit is consumed and before any side
effect starts.

The projector does not infer missing causality as success. It reports diagnostics
such as legacy event count, work event count, and work events missing causal
metadata.

## Flight Recorder projection

Phase 3 adds `buildFlightRecorderSession(session_id)`, a human-facing read-only projection over the existing session work graph. It summarizes session lifecycle, prevented actions, prevention conflicts, verification status, evidence and artifact references, governed memory provenance, and proof limitations. It does not create new causal links; missing `parent_event_id` or `causes` references remain visible as missing links, and execution certainty is explicit when linkage is incomplete.

The daemon exposes authenticated read-only Flight Recorder APIs for session summaries, prevented actions plus prevention conflicts, evidence/proof views, memory provenance, safe export, and the existing bounded timeline. These APIs require both the runtime bearer credential and the credential for the requested session.

See [FLIGHT_RECORDER.md](FLIGHT_RECORDER.md).

## Compatibility

Use `normalizeRuntimeEvent()` to read old ledger records as runtime governance events. Use `recordRuntimeGovernanceEvent()` to write normalized runtime events through the existing JSONL ledger without changing the top-level ledger schema.

## Phase 2 execution proof records

Managed executor outcomes may include `detail.execution_proof`, a normalized metadata-first record that links the authorized action to the observed execution result. The managed executor copies that proof into `execution.completed` and `verification.recorded` work-event data, hashes the proof payload into the existing evidence registry, and links the resulting `evidence_ids` and `artifact_ids` back into the session work graph.

The proof record is additive. Older sessions that do not contain `execution_proof` still reconstruct normally. `buildSessionWorkGraph(session_id)` exposes available proof records as `execution_proofs` without changing causal edge semantics.

Default proof records do not store file bodies, raw HTTP request or response bodies, full stdout/stderr, credentials, authorization headers, environment values, or hidden model reasoning. They prefer resolved context, hashes, sizes, status codes, byte counts, bounded/redacted snippets where already supported, and explicit verification status.