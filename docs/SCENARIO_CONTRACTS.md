# Scenario Contracts

Scenario contracts define the operational boundary for a task or agent loop.

Existing `createScenarioLoop()` contracts support:

- goal
- success condition
- max attempts
- max cost
- allowed and blocked commands
- approval-required command patterns
- allowed and blocked targets

The runtime governance contract expands this model for adapter and MCP integrations:

- allowed and forbidden actions
- allowed and forbidden tools
- allowed systems
- data boundaries
- cost, token, runtime, tool-call, and loop budgets
- approval requirements
- evidence requirements
- memory-write policy

## Example

```typescript
import { evaluateRuntimePolicy } from 'safeloop';

const scenario = {
  scenarioId: 'district-rag-ingestion',
  goal: 'Index approved local district documents',
  allowedActions: ['read', 'chunk', 'embed', 'query'],
  forbiddenActions: ['send external', 'delete source documents'],
  allowedTools: ['filesystem.read', 'ocr.local', 'vector.upsert'],
  allowedSystems: ['local-nas', 'local-vector-db'],
  maximumTokens: 500000,
  maximumCostUsd: 0,
  requireApprovalFor: ['delete', 'network', 'export'],
  requiredEvidenceFor: ['answer staff question'],
  memoryWritePolicy: 'require_review',
};

const decision = evaluateRuntimePolicy({
  agentId: 'hermes',
  action: 'send external summary',
  tool: 'email',
  target: 'external-recipient',
  context: { scenario },
});
```

If an action drifts outside the scenario, SafeLoop can warn, require approval, deny the action, or stop the agent depending on risk and policy.

## Boundary

Scenario contracts are enforceable only for actions routed through `createScenarioLoop()`, `evaluateRuntimePolicy()`, the command guard, MCP gateway tools, or adapters that call SafeLoop.
