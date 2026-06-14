# Safeloop

## Agent Accountability + Handoff SDK

Safeloop helps AI agents and humans collaborate through portable Case Files.

As teams move from one AI agent to many, the hardest problem is no longer execution—it is continuity. Context gets lost, decisions become unclear, approvals disappear, and work must be repeatedly explained to the next agent or reviewer.

Safeloop solves this by creating structured Case Files that travel with the work.

A Case File captures:

* Goals
* Context
* Decisions
* Risks
* Approvals
* Attachments
* Handoffs
* Reports

This creates a portable accountability trail that allows agents and humans to continue work without losing critical information.

Built for:

* Hermes
* OpenCode
* Claude Code
* Codex
* Replit Agents
* Custom agent workflows
* Scripts
* Human-operated workflows

### What Safeloop Provides

#### Agent Accountability

Track:

* what happened
* why it happened
* who made the decision
* what evidence was used
* what risks were accepted

#### Agent Handoffs

Transfer work between:

* agent → agent
* agent → human
* human → agent

without requiring the entire task to be re-explained.

#### Governance Primitives

Safeloop also includes:

* Policy Gates
* Circuit Breakers
* Action Ledgers
* Markdown Reports

These primitives help teams build safer agentic workflows while maintaining a complete accountability trail.

### Why Safeloop Exists

Git tracks code.

Safeloop tracks agent work.

Git answers:

"What changed?"

Safeloop answers:

"Why did it change?"
"Who decided?"
"What evidence was used?"
"What should happen next?"

### Local First

Safeloop is intentionally:

* local-first
* file-based
* lightweight
* TypeScript-native

No cloud service.
No database required.
No hosted platform.

Your Case Files remain under your control.

## Why this exists

Local AI agent loops fail in predictable ways:
- repeated retries on the same error
- uncontrolled scope expansion
- token burn on unproductive attempts
- unsafe actions that should be reviewed before execution

This package gives you small governance primitives instead of a full agent stack. It is designed to stay boring, auditable, and easy to reason about.

## How Safeloop is different

Safeloop is not an enterprise AI governance platform or full agent runtime.

It is a lightweight TypeScript SDK for local agentic coding workflows. It gives developers simple primitives they can embed around tools like OpenCode, Claude Code, Codex, Hermes-style operators, or custom scripts.

Use Safeloop when you want a small, understandable control layer:

- policy gates before execution
- circuit breakers during execution
- action ledgers after execution
- markdown reports for human review

## Governance loop

- Policy Gate before execution
- Circuit Breaker during execution
- Action Ledger after/during execution
- Markdown Report for human review
- Live Simulation for proof

## Agent Accountability + Handoff

Safeloop now also supports a small Case File layer for ownership, attribution, and handoff.

Use it when you want to track:
- goal
- owner
- project
- participants
- status
- context used
- decisions and rationale
- risks and mitigation
- approvals
- handoff notes and next actions

Each Case File can also attribute records to participants so you can see who created context, made decisions, raised risks, approved the work, and handed it off.

The Case File layer stays local-first and standalone. It can reference existing Safeloop artifacts like ledger entries or markdown reports, but it does not depend on them.

#### Handoff Manifest

The Handoff Manifest is a compact summary of a Case File for the next agent or human.

It is not a full handoff package yet.

It helps avoid re-explaining context during multi-agent collaboration by capturing the current state, the next owner, required evidence, open risks, pending approvals, recent decisions, and recommended next actions in a small machine-readable form.

#### Agent Adapter Protocol

Safeloop does not need to know which agent you use.
Any agent can emit lifecycle events into Safeloop.
Safeloop converts those events into Case Files, attachments, approvals, handoffs, manifests, and reports.

Lifecycle example:
- task.started
- context.loaded
- decision.made
- risk.detected
- approval.requested
- approval.resolved
- artifact.changed
- handoff.created
- task.completed
- report.generated

```typescript
import {
  addParticipant,
  createAgentSession,
  createCaseFile,
  exportAgentSessionJSON,
  exportAgentSessionMarkdown,
} from 'safeloop';

let caseFile = createCaseFile({
  goal: 'Implement the adapter protocol',
  owner: 'Hermes',
  project: 'Safeloop',
});

caseFile = addParticipant(caseFile, {
  id: 'OpenCode',
  name: 'OpenCode',
  type: 'agent',
  role: 'implementer',
});

const session = createAgentSession({
  adapter: {
    id: 'hermes-1',
    name: 'Hermes',
    agentType: 'hermes',
    capabilities: {
      canReadFiles: true,
      canWriteFiles: true,
      canRequestApproval: true,
      canHandoff: true,
      canGenerateReports: true,
    },
  },
  caseFile,
});

session.emit({
  id: 'evt-1',
  type: 'task.started',
  timestamp: '2026-06-14T00:00:00.000Z',
  agentId: 'hermes-1',
  agentName: 'Hermes',
  participantId: 'Hermes',
  caseId: caseFile.id,
  summary: 'Start the adapter protocol work',
  metadata: {
    goal: 'Implement the adapter protocol',
    project: 'Safeloop',
    owner: 'Hermes',
  },
});

session.emit({
  id: 'evt-2',
  type: 'decision.made',
  timestamp: '2026-06-14T00:01:00.000Z',
  agentId: 'opencode-1',
  agentName: 'OpenCode',
  participantId: 'OpenCode',
  caseId: caseFile.id,
  summary: 'Use explicit lifecycle events',
  metadata: {
    decision: 'Use explicit lifecycle events',
    rationale: 'Any agent can emit work into Safeloop',
  },
});

session.emit({
  id: 'evt-3',
  type: 'report.generated',
  timestamp: '2026-06-14T00:02:00.000Z',
  agentId: 'hermes-1',
  agentName: 'Hermes',
  participantId: 'Hermes',
  caseId: caseFile.id,
  summary: 'Generated the session report',
  metadata: {
    reportType: 'agent-session',
    path: 'docs/AGENT_SESSION.md',
  },
});

session.complete();

console.log(exportAgentSessionMarkdown(session));
console.log(JSON.stringify(exportAgentSessionJSON(session), null, 2));
```

#### Querying Safeloop

Safeloop also includes a lightweight report query layer.
These reports are generated from explicit local inputs such as Case Files, ledgers, handoff manifests, and project guardrail summaries.
They are not telemetry.
Safeloop does not automatically collect personal data, conversations, or model output.

Use it when you want to ask:
- What was checked?
- What passed?
- What failed?
- What guardrails were enforced?
- What evidence supports the result?
- Is this ready for handoff or release?

```typescript
import {
  addCaseContext,
  addParticipant,
  createCaseFile,
  createProjectGuardrailReport,
  exportSafeloopQueryMarkdown,
  querySafeloop,
  recordCaseDecision,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from 'safeloop';

let caseFile = createCaseFile({
  goal: 'Hand off the current agent task',
  owner: 'Hermes',
  project: 'Safeloop',
});

caseFile = addParticipant(caseFile, {
  id: 'OpenCode',
  name: 'OpenCode',
  type: 'agent',
  role: 'implementer',
});

caseFile = addParticipant(caseFile, {
  id: 'Charles',
  name: 'Charles',
  type: 'human',
  role: 'approver',
});

caseFile = addCaseContext(caseFile, {
  contextUsed: 'Existing breaker and ledger flow',
  references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
  createdBy: 'Hermes',
});

caseFile = recordCaseDecision(caseFile, {
  decision: 'Keep the new layer additive',
  rationale: 'Preserve existing behavior and APIs',
  createdBy: 'OpenCode',
});

caseFile = requestCaseApproval(caseFile, {
  subject: 'Approve the handoff',
  requestedBy: 'Hermes',
  requestedByParticipantId: 'Hermes',
  requestedFor: 'Charles',
});

caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
  status: 'approved',
  approver: 'Charles',
  resolvedByParticipantId: 'Charles',
});

caseFile = recordHandoff(caseFile, {
  from: 'Hermes',
  to: 'OpenCode',
  fromParticipantId: 'Hermes',
  toParticipantId: 'OpenCode',
  handoffNotes: 'Continue from the approved case file.',
  recommendedNextActions: ['Review context', 'Continue implementation'],
});

const queryReport = querySafeloop(caseFile, {
  type: 'release-readiness',
  includeEvidence: true,
  includeRisks: true,
  includeApprovals: true,
  includeAttachments: true,
});

const projectReport = createProjectGuardrailReport({
  projectName: 'PLOTS',
  policyName: 'plots-safeloop-policy',
  purpose: 'decision-simulation and perspective-reflection tool',
  filesChecked: ['README.md', 'docs/PRODUCT_BLUEPRINT.md'],
  directoriesChecked: ['agents', 'docs', 'prompts'],
  guardrails: ['no diagnosis', 'no telemetry'],
  validationCommands: ['npm run safeloop'],
  result: 'PASS',
});

console.log(exportSafeloopQueryMarkdown(queryReport));
console.log(projectReport.summary);
```

## Install

Safeloop v0.6.0 installs with:

```bash
npm install safeloop
```

Zero runtime dependencies.

## Quick start

```typescript
import { createPolicyGate, createBreaker } from 'safeloop';

const gate = createPolicyGate({
  oversightMode: 'HITL',
  allowedFiles: ['README.md', 'src/**'],
  allowedCommands: ['npm test', 'npm run build'],
  blockedCommands: ['git push', 'npm publish'],
  maxRisk: 'medium',
});

const decision = gate.evaluate({
  task: 'Update docs and run validation',
  requestedFiles: ['README.md'],
  requestedCommands: ['npm test'],
  risk: 'low',
});

if (!decision.allowed) {
  throw new Error(decision.message);
}

const breaker = createBreaker({ maxRetries: 3 });
const result = await breaker.run(async () => ({ ok: true, _stepTokenCost: 50 }));

console.log(decision.message);
console.log(result.success);
```

Run the live simulation from this repo after `npm install` or `npm ci`:

```bash
npm run example:live-simulation
```

The simulation is repo-local and uses the TypeScript example harness. It is for proof and review, not a security boundary.

## API references

### `createPolicyGate(config)`

Creates a pre-run approval gate for local agent work. It evaluates requested files, requested commands, risk, and approval state.

Returns a decision with:
- `allowed`
- `requiresApproval`
- `reasons`
- `violations`
- `message`

### `createAgentRunLedger(metadata)`

Creates an in-memory run ledger for prompts, commands, changed files, validations, scope checks, approvals, and closeout.

Common methods:
- `recordPrompt()`
- `recordCommand()`
- `recordChangedFiles()`
- `recordValidation()`
- `recordScopeCheck()`
- `recordApproval()`
- `close()`
- `toMarkdown()`

Disclaimer: this package provides governance primitives, not a complete security boundary. Users must still sandbox tools, restrict credentials, review diffs, and apply least-privilege access.

## Breaker API quick start

```typescript
import { createBreaker } from 'safeloop';

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

1. **Return value**: return `{ _stepTokenCost: 150 }` or `{ _tokenEstimate: 150 }` from your task. For compatibility with some consumers, `tokensUsed: 150` is also accepted.
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
import { createBreaker, BREAKER_PRESETS } from 'safeloop';

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
} from 'safeloop';

const breaker = createCodingAgentBreaker();
const result = await breaker.run(runCodingLoop);

console.log(toMarkdownReport(result));
```

- `createCodingAgentBreaker(config?)` uses `BREAKER_PRESETS.standardCodingAgent` by default and lets you override only the settings you need.
- `toMarkdownReport(result)` turns a `BreakerResult` into a compact Markdown summary you can print after a run.
- `breaker.run(...)` is async, so always `await` it before passing the result into `toMarkdownReport(...)`.

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
import { createAgentRunLedger } from 'safeloop';

const ledger = createAgentRunLedger({
  runId: 'run-001',
  agent: 'Hermes',
  executor: 'OpenCode',
  repo: 'safeloop',
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

## Policy Gate: approve before execution

Policy Gate runs before the agent starts.
Circuit Breaker supervises during execution.
Agent Action Ledger records what happened.

Together they form a small governance loop for local AI agents.

Example:

```typescript
import { createPolicyGate } from 'safeloop';

const gate = createPolicyGate({
  oversightMode: "HITL",
  allowedFiles: ["README.md", "examples/**"],
  allowedCommands: ["npm test", "npm run build", "git status", "git diff"],
  blockedCommands: ["git push", "npm publish", "rm -rf"],
  maxRisk: "medium",
});

const decision = gate.evaluate({
  task: "Update README documentation",
  requestedFiles: ["README.md"],
  requestedCommands: ["npm test"],
  risk: "low",
});

if (!decision.allowed) {
  throw new Error(decision.message);
}
```

Policy Gate uses simple, conservative matching:
- allowedFiles supports exact paths, `/*` for direct children, and `/**` for recursive folder access.
- Windows backslashes are normalized to forward slashes before matching.
- blockedCommands are matched by case-insensitive substring so obvious dangerous commands are caught.
- allowedCommands are matched by normalized exact command string.

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
