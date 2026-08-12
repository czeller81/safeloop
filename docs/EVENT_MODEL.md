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
- causal references: `parent_event_id` and `causes`
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
- Daemon: `POST /v1/session/timeline` with `{ "session_id": "..." }`

The projector does not infer missing causality as success. It reports diagnostics
such as legacy event count, work event count, and work events missing causal
metadata.

## Compatibility

Use `normalizeRuntimeEvent()` to read old ledger records as runtime governance events. Use `recordRuntimeGovernanceEvent()` to write normalized runtime events through the existing JSONL ledger without changing the top-level ledger schema.
