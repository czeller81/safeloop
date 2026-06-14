# Safeloop Agent Adapter Protocol

## Purpose

The Agent Adapter Protocol lets any agent, script, or human workflow emit explicit lifecycle events into Safeloop.

Safeloop does not run the agent.
Safeloop does not control the model.
Safeloop does not execute shell commands.
Safeloop does not collect telemetry.
Safeloop does not send network data.
Safeloop does not store secrets.
Safeloop does not replace human approval.

Safeloop only records explicit events that a wrapper, agent, or workflow emits.

## Event lifecycle

Typical lifecycle:

- task.started
- context.loaded
- decision.made
- risk.detected
- approval.requested
- approval.resolved
- artifact.changed
- model.usage
- steering.applied
- test.completed
- handoff.created
- task.completed
- report.generated

Those events are transformed into:

- Case File updates
- context trail entries
- decisions
- risks
- approvals
- attachments
- handoffs
- handoff manifests
- query reports

## Event schema

Each event contains:

- id
- type
- timestamp
- agentId
- agentName? 
- participantId?
- caseId?
- summary
- metadata?

Event metadata is explicit and event-specific.

Examples:

- task.started: goal, project, owner
- context.loaded: source, notes, references
- decision.made: decision, rationale, tradeoffs
- risk.detected: risk, severity, mitigation
- approval.requested: reason, approver
- approval.resolved: approvalId, decision, approver, note
- artifact.changed: path, artifactType, changeSummary
- handoff.created: from, to, notes, recommendedNextActions
- task.completed: result, outputSummary
- report.generated: reportType, path

## Adapter schema

An adapter describes the agent that emitted the event.

Fields:

- id
- name
- agentType
- version?
- capabilities?

Agent types:

- hermes
- opencode
- claude-code
- codex
- replit-agent
- custom
- human

Capabilities:

- canReadFiles
- canWriteFiles
- canRunCommands
- canRequestApproval
- canHandoff
- canGenerateReports

## Session recorder

createAgentSession() records a sequence of events for one task.

It preserves order, updates the Case File through processAgentEvent(), and exposes the recorded event list.

A session can also export:

- Markdown summary
- JSON summary
- query reports from the current Case File
- handoff manifests from the current Case File

Example:

```typescript
const session = createAgentSession({ adapter, caseFile });

session.emit({
  type: 'decision.made',
  summary: 'Use explicit local lifecycle events',
  metadata: {
    decision: 'Use explicit local lifecycle events',
    rationale: 'Avoid telemetry and hidden capture',
  },
});

session.complete();
```

## Examples

Use the protocol from:

- Hermes
- OpenCode
- Claude Code
- Codex
- Replit Agents
- custom wrappers
- scripts
- human-operated workflows

Hermes can be the first example, but it is not a requirement.

## Boundaries

Safeloop does not:

- run the agent
- control the model
- execute shell commands
- collect telemetry
- send network data
- store secrets
- replace human approval

Safeloop only records explicit events emitted by the agent or wrapper.

## Design notes

The protocol is intentionally simple:

- explicit in, explicit out
- local-first
- additive
- backward compatible with existing Case File APIs
- predictable transformation from event to record

If an integration needs hidden inference or background collection, it is out of scope for Safeloop.
