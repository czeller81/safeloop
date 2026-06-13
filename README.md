# agent-circuit-breaker

A framework-agnostic circuit breaker for AI agent loops. Prevents agents from burning tokens forever when they get stuck on repeating failures, uncontrolled scope expansion, or excessive token use.

## Why

AI agents get stuck in loops. They repeat the same failed LLM call, expand the task scope without asking, or drain your API budget on fruitless retries. Most agent frameworks leave this to the developer.

This library is a drop-in guard that:

- Stops retrying after a configurable limit.
- Detects when the same error keeps recurring.
- Tracks estimated token usage per step and per task.
- Prevents silent scope expansion.
- Provides a manual kill switch.
- Logs every attempt, failure, and decision.
- Returns a structured result explaining what happened and what a human should do next.

## Hermes + OpenCode Experiment

This package can be used as a circuit breaker guardrail for AI coding agents, including Hermes and OpenCode, to prevent retry loops, token burn, scope expansion, and unsafe unattended execution.

Example: [`examples/hermes-opencode-loop.ts`](examples/hermes-opencode-loop.ts) -- simulated Hermes/OpenCode coding loop with retry, scope-freeze, and token budget protection.

## Install

```bash
npm install agent-circuit-breaker
```

Zero runtime dependencies.

## Quick start

```typescript
import { createBreaker } from 'agent-circuit-breaker';

const breaker = createBreaker({
  maxRetries: 3,
  maxRepeatedErrors: 2,
  tokenBudget: { perStep: 1000, perTask: 5000 },
});

async function myAgentTask(ctx) {
  // ctx.attempt      - current attempt number (1-based)
  // ctx.tokenUsed    - tokens consumed so far
  // ctx.signal       - AbortSignal (check ctx.signal.aborted for cancellation)
  // ctx.log(entry)   - add custom audit entries
  // ctx.proposeScopeChange(desc, goals) - request scope expansion

  // Report token usage via the return value:
  return { result: 'done', _stepTokenCost: 150 };
}

const result = await breaker.run(myAgentTask);

if (!result.success) {
  console.log(result.escalationMessage);
  // The agent loop was stopped.
  //
  // What failed: ...
  // What was tried: ...
  // Why it stopped: ...
  // What a human should decide next: ...
}
```

## API

### `createBreaker(config?)`

Returns a `Breaker` instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | number | `3` | Maximum attempts before hard stop. Set to `0` for a single attempt with no retries. |
| `maxRepeatedErrors` | number | `2` | Number of consecutive identical errors before escalation. Set to `0` to disable. |
| `tokenBudget.perStep` | number | `Infinity` | Maximum estimated tokens for a single step. |
| `tokenBudget.perTask` | number | `Infinity` | Maximum estimated tokens across all attempts. |
| `scopeFreeze` | boolean | `true` | When true, tasks may not add new goals without calling `proposeScopeChange()`. |

### `breaker.run(taskFn)`

Executes the task function with retry logic. Returns a `BreakerResult`.

The task function receives a `BreakerContext` with:

- **`attempt`** — current attempt number (1-based).
- **`tokenUsed`** — estimated tokens consumed so far in this run, including ALL attempts (both successful and failed).
- **`signal`** — an `AbortSignal`. When `trip()` is called, this signal is aborted. Cooperative tasks should check `ctx.signal.aborted` and exit cleanly.
- **`log(entry)`** — add a custom entry to the audit log. Entry shape: `{ type, message, metadata? }`.
- **`recordTokenUsage(cost)`** — explicitly record token usage for the current attempt. Adds to the cumulative `tokenUsed` and logs a `token_usage` audit entry.
- **`proposeScopeChange(description, goals)`** — request approval to expand scope. Returns `false` when `scopeFreeze` is enabled, `true` when disabled. Calling this when `scopeFreeze` is enabled will cause the breaker to trip after the task completes.

**Token tracking** — the library accumulates estimated token usage across all attempts. Tokens can be reported three ways:

1. **Return value**: return `{ _stepTokenCost: 150 }` or `{ _tokenEstimate: 150 }` from your task.
2. **Error object**: set `error._stepTokenCost` or `error._tokenEstimate` before throwing.
3. **Explicit**: call `ctx.recordTokenUsage(150)` at any point during the task.

These are conventions, not enforced counts — the library does not count tokens itself.

### `breaker.trip(reason)`

Manual kill switch. Aborts the `AbortSignal` passed to `ctx.signal`. After the current task attempt completes, the breaker returns a `kill_switch` result. For cooperative tasks that check `ctx.signal.aborted`, this allows clean shutdown.

### `breaker.reset()`

Clears all internal state (audit log, attempt count, kill switch flag, etc.). The breaker can be reused after reset.

### `breaker.status()`

Returns `{ isTripped: boolean, isKilled: boolean, attempts: number, tripReason: string | null }`.

### `breaker.log()`

Returns a copy of all accumulated audit entries.

### Result shape

```typescript
{
  success: boolean,              // true only if the task completed without being stopped
  stoppedBy: string,             // 'max_retries' | 'repeated_error' | 'token_budget_task'
                                 // | 'token_budget_step' | 'scope_freeze' | 'kill_switch' | ''
  attempts: number,              // total attempts made
  tokenEstimate: number,         // estimated tokens consumed (cumulative across ALL attempts)
  lastError: string | null,      // error message from the last failed attempt
  escalationMessage: string | null, // human-readable message explaining what failed,
                                 // what was tried, why it stopped, and next steps
  auditEntries: AuditEntry[],    // full audit trail for this run
  data?: unknown,                // return value of taskFn on success
}
```

### Audit entry shape

```typescript
{
  timestamp: number,             // Date.now() when the entry was created
  type: 'attempt' | 'retry' | 'failure' | 'budget_check' | 'breaker_trip'
      | 'kill_switch' | 'escalation' | 'scope_denied' | 'scope_proposed' | 'token_usage',
  message: string,
  metadata?: Record<string, unknown>,
}
```

## Config example

```typescript
// All options shown with their defaults:
const breaker = createBreaker({
  maxRetries: 3,
  maxRepeatedErrors: 2,
  tokenBudget: {
    perStep: Infinity,
    perTask: Infinity,
  },
  scopeFreeze: true,
});
```

## Presets

Use the built-in `BREAKER_PRESETS` for common agent-loop safety modes:

```typescript
import { createBreaker, BREAKER_PRESETS } from 'agent-circuit-breaker';

const breaker = createBreaker(BREAKER_PRESETS.standardCodingAgent);
```

| Preset | maxRetries | maxRepeatedErrors | perStep | perTask | scopeFreeze |
|--------|-----------|-------------------|---------|---------|-------------|
| `conservativeCodingAgent` | 1 | 1 | 4000 | 12000 | true |
| `standardCodingAgent` | 2 | 2 | 8000 | 30000 | true |
| `exploratoryResearchAgent` | 3 | 2 | 12000 | 60000 | false |

### Hermes/OpenCode helpers

For Hermes/OpenCode-style loop engineering workflows, the package includes two small convenience helpers:

```typescript
import {
  createCodingAgentBreaker,
  toMarkdownReport,
} from 'agent-circuit-breaker';

const breaker = createCodingAgentBreaker();
const result = await breaker.run(runCodingLoop);

console.log(toMarkdownReport(result));
```

- `createCodingAgentBreaker(config?)` uses `BREAKER_PRESETS.standardCodingAgent` by default and lets you override only the settings you need.
- `toMarkdownReport(result)` turns a `BreakerResult` into a compact Markdown summary you can print after a run.

These helpers are meant to make local agent-loop experiments easier to read, easier to tune, and easier to hand back to a human when the breaker trips.

## Agent Action Ledger

The circuit breaker is the emergency brake.
The Agent Action Ledger is the audit trail.

Together they form the foundation for local AI agent governance:
- The breaker stops unsafe or runaway loops.
- The ledger records what the agent tried, changed, validated, and approved.
- Combined, they make agent runs easier to review, debug, and control.

Example:

```typescript
import { createAgentRunLedger } from 'agent-circuit-breaker';

const ledger = createAgentRunLedger({
  runId: 'run-001',
  agent: 'Hermes',
  executor: 'OpenCode',
  repo: 'agent-circuit-breaker',
  task: 'ship ledger v1',
  allowedFiles: ['src/index.ts', 'tests/breaker.test.ts'],
  startedAt: new Date().toISOString(),
});

ledger.recordPrompt('Add the Agent Action Ledger API.');
ledger.recordCommand('npm test', { exitCode: 0, summary: 'passed' });
ledger.recordValidation('npm test', 'passed');
ledger.close('completed');

console.log(ledger.toMarkdown());
```

## Features

### 1. Hard loop limit (`maxRetries`)

Stops after N attempts on the same task. Attempt 1 is the first try; attempts 2 through N+1 are retries. Default: 3 retries (4 total attempts).

### 2. Token budget limit (`tokenBudget`)

Two independent limits:
- `perStep` — maximum tokens for a single step. Trips if a step's reported cost exceeds this.
- `perTask` — maximum tokens across all attempts. Trips if cumulative cost exceeds this.

Token counting is **estimated** — your task function reports `_stepTokenCost` or `_tokenEstimate` on its return value or on thrown error objects, or via `ctx.recordTokenUsage()`. Tokens are accumulated across **all** attempts, including failed ones. The library does not count tokens itself.

### 3. Repeated error detection (`maxRepeatedErrors`)

When the same normalized error message appears N times consecutively (no alternating errors in between), the breaker trips with `repeated_error`. Errors are normalized by stripping stack traces — only the first line of the message is compared. Default threshold: 2.

Set to `0` to disable.

### 4. Scope freeze (`scopeFreeze`)

Two detection mechanisms:

1. **Explicit** — call `ctx.proposeScopeChange(description, goals)` to request scope expansion. Returns `false` when scope freeze is enabled. The breaker trips after the task completes.
2. **Heuristic** — if the task returns an object containing `_newGoals`, `newGoals`, `_newTasks`, or `newTasks` as a non-empty array, the breaker trips.

Both are disabled when `scopeFreeze: false`.

### 5. Kill switch (`trip()`)

Call `breaker.trip(reason)` to stop the current run. This:
- Sets `killSwitchEngaged` flag.
- Aborts the `AbortSignal` available via `ctx.signal`.
- After the current task attempt finishes, the breaker returns `kill_switch` result.

**Important**: The kill switch is cooperative. It signals cancellation via `AbortSignal`, but the running task must check `ctx.signal.aborted` to stop promptly. If the task is blocked on a native promise that never resolves, the breaker will wait for it. Always design your agent tasks to be cooperative by periodically checking the signal.

### 6. Audit log

Every attempt, failure, retry, budget check, scope proposal/denial, and trip is recorded. Access via `result.auditEntries` or `breaker.log()`.

### 7. Escalation messages

When the breaker trips, `result.escalationMessage` contains a structured human-readable message with four sections:
- **What failed** — description of the error or situation.
- **What was tried** — number of attempts made.
- **Why it stopped** — the specific threshold or condition that triggered the stop.
- **What a human should decide next** — suggested next steps.

## AbortSignal example

```typescript
const breaker = createBreaker();

// Simulate user pressing Ctrl+C after 2 seconds
setTimeout(() => breaker.trip('user cancelled'), 2000);

const result = await breaker.run(async (ctx) => {
  for (let step = 0; step < 10; step++) {
    // Check for cancellation before each step
    if (ctx.signal.aborted) {
      // Clean up and return
      return `cancelled at step ${step}`;
    }
    // Do work...
    await doSomeWork();
  }
  return 'completed';
});
```

## Scope freeze example

```typescript
const breaker = createBreaker({ scopeFreeze: true });

const result = await breaker.run(async (ctx) => {
  const approved = ctx.proposeScopeChange(
    'add new tasks',
    ['write documentation', 'create examples'],
  );
  if (!approved) {
    // Stay within original scope
    return 'original task done';
  }
  return 'expanded task done';
});
// result.success === false
// result.stoppedBy === 'scope_freeze'
```

## Limitations

- **Token tracking is estimated**. The library relies on your task function to report `_stepTokenCost` or `_tokenEstimate`. It does not count tokens itself.
- **Kill switch is cooperative**. It signals via `AbortSignal` but cannot interrupt a non-cooperative task that never checks the signal or yields. Design tasks to periodically check `ctx.signal.aborted`.
- **Scope freeze heuristic is best-effort**. Detecting `_newGoals` / `newGoals` / `_newTasks` / `newTasks` on the return value is a simple convention, not a sandbox. The explicit `proposeScopeChange()` mechanism is the recommended approach.
- **Single-threaded**. Each breaker instance is designed for one agent loop at a time.
- **Error normalization is simple**. Only the first line of the error message is compared. Stack traces are ignored. If your errors have dynamic content (timestamps, request IDs) in the message line, consider normalizing them before throwing.

## Design principles

- **Framework agnostic** — works with LangChain, Vercel AI SDK, OpenAI SDK, or custom agent loops.
- **Small and boring** — ~250 lines, zero runtime dependencies, easy to audit.
- **Safe by default** — sane defaults (3 retries, 2 repeated errors, scope freeze on).
- **Human override always available** — kill switch via `trip()` with cooperative signal.
- **Honest about failure** — structured results, clear escalation messages, documented limitations.

## License

MIT
