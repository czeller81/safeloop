# Safeloop Agent Adapter Protocol

## Purpose

The Agent Adapter Protocol lets any agent, script, or human workflow emit explicit lifecycle events into Safeloop.

Safeloop does not run the agent.
Safeloop does not control the model.
Safeloop executes shell commands only when they are routed through the command guard or MCP gateway.
Safeloop does not collect telemetry.
Safeloop does not send network data.
Safeloop does not store secrets.
Safeloop does not replace human approval.

Safeloop records explicit events that a wrapper, agent, or workflow emits. For runtime enforcement, adapters should also call the command guard, MCP gateway, `guardEffect`, `evaluateRuntimePolicy()`, and `verifyCandidateMemory()` before consequential actions.

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
- token.cost
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

## Token / cost event example

External agents should emit a token.cost event when they have explicit token and spend data.

Example payload:

```json
{
  "id": "token-cost-2026-06-14T11:01:00.000Z",
  "type": "token.cost",
  "timestamp": "2026-06-14T11:01:00.000Z",
  "agentId": "hermes-1",
  "caseId": "case-1",
  "summary": "Token cost recorded for gpt-5-mini",
  "metadata": {
    "provider": "OpenAI",
    "model": "gpt-5-mini",
    "modelArchitecture": "hosted",
    "inputTokens": 8000,
    "outputTokens": 1200,
    "totalTokens": 9200,
    "estimatedCost": 0.0065,
    "timestamp": "2026-06-14T11:01:00.000Z",
    "agentId": "hermes-1",
    "agent": "Hermes",
    "caseId": "case-1",
    "project": "Safeloop",
    "taskId": "task-monitor-demo",
    "taskName": "Build the loop monitor demo"
  }
}
```

Safeloop accepts the same metadata shape for model.usage for backward compatibility, but token.cost is the preferred explicit schema.

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

## Runtime governance hook

Adapters that can execute tools should evaluate proposed actions before execution:

```typescript
import { createRuntimeCircuitBreaker, evaluateRuntimePolicy } from 'safeloop';

const breaker = createRuntimeCircuitBreaker();

const input = {
  agentId: adapter.id,
  agentName: adapter.name,
  agentType: adapter.agentType,
  action: 'publish release to production',
  tool: 'deploy',
  target: 'production',
  context: {
    hasHumanApproval: false,
    scenario: {
      scenarioId: 'release',
      requireApprovalFor: ['publish', 'deploy'],
    },
  },
};

const decision = evaluateRuntimePolicy(input);
const circuit = breaker.evaluate(input, decision);

if (!decision.allowed || circuit.state === 'OPEN' || circuit.state === 'LOCKED') {
  // Do not execute. Ask for review or stop the agent.
}
```

## Memory governance hook

Adapters with durable memory should verify candidate memories before writing:

```typescript
import { verifyCandidateMemory } from 'safeloop';

const result = verifyCandidateMemory({
  memory_id: 'mem-001',
  memory_type: 'lesson',
  agent: adapter.id,
  situation: 'The agent completed a local RAG task.',
  lesson: 'Use district-approved source documents for policy answers.',
  confidence: 0.9,
  evidence: ['artifact-review-001'],
});

if (!result.allowed) {
  // Store for review or quarantine instead of writing durable memory.
}
```

## Boundaries

Safeloop does not:

- run the agent
- control the model
- collect telemetry
- send network data
- store secrets
- replace human approval

Safeloop governs only work routed through its APIs. Direct private tools, direct shell calls, direct API calls, or private memory writes can bypass Safeloop unless the host integrates them.

## Design notes

The protocol is intentionally simple:

- explicit in, explicit out
- local-first
- additive
- backward compatible with existing Case File APIs
- predictable transformation from event to record

If an integration needs hidden inference or background collection, it is out of scope for Safeloop.
