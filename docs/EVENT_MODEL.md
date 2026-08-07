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

## Compatibility

Use `normalizeRuntimeEvent()` to read old ledger records as runtime governance events. Use `recordRuntimeGovernanceEvent()` to write normalized runtime events through the existing JSONL ledger without changing the top-level ledger schema.
