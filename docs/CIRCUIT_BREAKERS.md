# Runtime Circuit Breakers

SafeLoop includes two circuit-breaker layers:

- `createBreaker()` for cooperative retry/token/scope loop control.
- `createRuntimeCircuitBreaker()` for runtime governance decisions around actions and tools.

## Runtime Circuit States

- `CLOSED`: normal operation
- `WARNING`: suspicious pattern detected, but not stopped yet
- `OPEN`: pause or require human review
- `LOCKED`: fail-closed state for critical risk

## Signals

The runtime circuit breaker can trigger from:

- repeated identical tool calls
- repeated denied actions
- repeated failures
- token threshold breach
- cost threshold breach
- critical fail-closed policy risk

## Example

```typescript
import { createRuntimeCircuitBreaker, evaluateRuntimePolicy } from 'safeloop';

const breaker = createRuntimeCircuitBreaker({
  maxRepeatedToolCalls: 3,
  maxDeniedActions: 2,
  maximumTokens: 100000,
});

const decision = evaluateRuntimePolicy({
  agentId: 'opencode',
  action: 'call local search',
  tool: 'rag.search',
  target: 'district-vector-db',
});

const status = breaker.evaluate({
  agentId: 'opencode',
  action: 'call local search',
  tool: 'rag.search',
  target: 'district-vector-db',
}, decision);

if (status.state === 'OPEN' || status.state === 'LOCKED') {
  // Pause the agent or require human approval.
}
```

When the breaker leaves `CLOSED`, SafeLoop records a `circuit_breaker.triggered` event in the local ledger.
