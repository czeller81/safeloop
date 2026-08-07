# Runtime Policy Engine

`evaluateRuntimePolicy()` is a deterministic runtime policy evaluator for consequential agent actions.

It returns one of:

- `ALLOW`
- `ALLOW_WITH_WARNING`
- `REQUIRE_APPROVAL`
- `PAUSE`
- `DENY`
- `STOP_AGENT`

## Disposition Semantics

| Disposition | Meaning | Execution guidance |
| --- | --- | --- |
| `ALLOW` | No deterministic governance rule blocked the action. | Integration may execute and should record outcome/evidence. |
| `ALLOW_WITH_WARNING` | Action may proceed, but uncertainty or medium risk was detected. | Execute only if the workflow accepts warning-level risk; record the warning. |
| `REQUIRE_APPROVAL` | Human approval is required before execution. | Do not execute until approval is valid and bound to the same context. |
| `PAUSE` | Workflow should pause for operator or policy review. | Do not execute until the pause is resolved. |
| `DENY` | Action violates policy or scenario boundaries. | Do not execute. |
| `STOP_AGENT` | Agent should be stopped because continuing is unsafe. | Stop or isolate the agent. |

These dispositions are binding only when the caller treats them as binding. SafeLoop cannot stop a private tool path that ignores the decision.

Each decision includes:

- final disposition
- allow/approval/pause/stop booleans
- triggered policy IDs
- normalized risk dimensions
- explanation
- required approval level when applicable
- evidence used
- confidence
- recommended remediation
- a normalized runtime event

## Path-Aware Evaluation

Policies can consider the execution path, not only the current action:

- prior events
- cumulative cost
- cumulative tokens
- loop count
- retry count
- scenario budgets
- active scenario boundaries
- current human approval state
- approval expiration

## Deterministic Risk Dimensions

Runtime risk dimensions are transparent signals, not fake precision scores:

- `DATA_EXPOSURE`
- `PRIVILEGE_ESCALATION`
- `DESTRUCTIVE_ACTION`
- `EXTERNAL_COMMUNICATION`
- `FINANCIAL_ACTION`
- `PRODUCTION_CHANGE`
- `IDENTITY_OR_PERMISSION_CHANGE`
- `SECURITY_IMPACT`
- `LEGAL_OR_COMPLIANCE`
- `PERSONAL_DATA`
- `COST_ANOMALY`
- `LOOP_ANOMALY`
- `UNVERIFIED_EVIDENCE`
- `MEMORY_POISONING`
- `AGENT_HANDOFF_RISK`
- `MODEL_UNCERTAINTY`

## Example

```typescript
import { evaluateRuntimePolicy } from 'safeloop';

const decision = evaluateRuntimePolicy({
  agentId: 'hermes',
  action: 'publish release to production',
  tool: 'deploy',
  target: 'production',
  context: {
    hasHumanApproval: false,
    scenario: {
      scenarioId: 'release-review',
      requireApprovalFor: ['publish', 'deploy'],
      requiredEvidenceFor: ['publish'],
    },
  },
});

if (!decision.allowed) {
  // Do not execute the action.
}
```

## Boundary

The policy engine returns decisions. Enforcement happens only when an adapter, MCP tool, command guard, or host application honors those decisions.
