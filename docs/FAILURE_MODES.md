# Failure Modes

SafeLoop should not silently choose one failure behavior for every action.

## Recommended Defaults

| Failure | Low-risk read | Consequential action |
| --- | --- | --- |
| SafeLoop unavailable | configurable fail-open | fail-closed |
| Policy engine error | configurable fail-open | fail-closed |
| Approval unavailable | hold | fail-closed or require review |
| Invalid policy | warn for read-only | fail-closed |
| Corrupted ledger line | skip malformed line and report diagnostics | continue valid reads |
| Missing expected effect adapter | warn for non-production | fail-closed for production-impacting effects |

## Current Implementation

- Event reads skip malformed JSONL lines and preserve valid events.
- Command guard denial and approval-required decisions do not execute shell commands.
- Runtime policy can mark high-risk actions as denied or stopped.
- `createGovernedPolicyEngine()` returns fail-closed `DENY` decisions for high-risk actions when policy evaluation throws, times out, or returns malformed/null data.
- Low-risk fail-open behavior is explicit and returns `ALLOW_WITH_WARNING`.
- Runtime circuit breaker records trigger events and can enter `WARNING`, `OPEN`, or `LOCKED`.
- Effect guard reports missing registered adapters and fails closed for expected production-impacting coverage gaps.

For asynchronous policy calls, use `evaluateAsync()`. It enforces `timeoutMs` and converts timeout, thrown, null, undefined, or malformed results into fail-closed or explicitly fail-open decisions. Invalid timeout values such as zero, negative numbers, or `NaN` fall back to the default timeout rather than disabling timeout handling.

## Examples

High-risk policy failure:

```typescript
const engine = createGovernedPolicyEngine();
const result = engine.evaluate({
  agentId: 'agent-1',
  action: 'deploy to production',
  tool: 'deploy',
  target: 'production',
});

if (!result.allowed) {
  // Do not execute.
}
```

Low-risk fail-open must be configured or match low-risk read/list/status patterns. It returns a warning, not a silent success.

## Operator Guidance

For school districts and other sensitive local deployments, configure:

- local-only model and vector-store access
- network egress controls outside SafeLoop
- guarded MCP tools only
- explicit approval roles
- scenario budgets
- audit export retention
- ledger seal verification before review
