# SafeLoop

**Local-first agent governance SDK and dashboard for AI-assisted work.**

SafeLoop helps teams observe agent work, route risky actions through guardrails, request human approval, and preserve audit evidence in a local ledger.

> Observe. Decide. Approve. Prove.

## What SafeLoop Is

SafeLoop is an open-source, local-first TypeScript toolkit for cooperative AI agent governance:

- **Command guard / circuit breaker**: allow, block, or hold shell commands before execution when agents route commands through SafeLoop.
- **Specialist governance**: route tasks to specialists, validate specialist tool access, bind delegated authorizations to execution context, and record specialist review evidence.
- **Effect guard coverage**: mediate externally meaningful effects through registered adapters and report known coverage gaps honestly.
- **Scenario loop governance**: evaluate multi-step agent work against a scenario contract and emit auditable decisions.
- **MCP stdio tools**: expose SafeLoop command checks, governed command execution, activity recording, and status through a stdio MCP server.
- **Agent connector foundation**: provide connector detection and integration paths for generic CLI agents and Hermes.
- **Local trace-first dashboard**: inspect agent events, SafeLoop decisions, human review, evidence, and cost/accountability signals.
- **Audit event ledger**: append local JSONL events under `.safeloop/events.jsonl`.
- **Token/cost/timecard accountability**: record model usage, cost estimates, billable timecard candidates, handoffs, risks, and approvals.

SafeLoop does not require a hosted service, database, cloud account, or external telemetry pipeline.

## Honest Security Boundary

SafeLoop is a **cooperative local governance layer**, not an OS sandbox.

When an agent or tool routes a command through SafeLoop, SafeLoop can:

- allow the command and execute it,
- block the command before it reaches the shell,
- or require human approval and hold the command.

SafeLoop records and mediates effects routed through `guardEffect`, MCP gateway tools, `createCommandGuard().run()`, scenario-loop command steps, or registered adapters.

SafeLoop does **not** universally intercept private agent tools, direct shell calls, direct file writes, direct API calls, publishing, messaging, deployments, network requests, or process launches that bypass SafeLoop. Agents and MCP hosts must be configured to use SafeLoop's command guard, CLI wrapper, MCP tools, effect guard, or connector runtime hook. For non-cooperative containment, use an OS-level sandbox, container, VM, or system policy layer in addition to SafeLoop.

## Quick Start

```bash
npm install
npm test
npm run build
```

Useful local demos:

```bash
# Command guard proof: allowed, blocked, approval-required
npx ts-node examples/command-guard-demo.ts

# Scenario loop proof: continue, block, escalate, success, stop
npx ts-node examples/scenario-loop-demo.ts

# Connector status
npx ts-node examples/connector-status-demo.ts

# MCP command gateway demo
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

## Command Guard

```typescript
import { createCommandGuard } from 'safeloop';

const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    blockedCommands: ['rm -rf', 'DROP TABLE'],
    requireApprovalFor: ['git push', 'deploy', 'npm publish'],
  },
  agentId: 'my-agent',
  agentName: 'My Agent',
  storageOptions: { baseDir: process.cwd() },
});

const result = guard.run('echo hello');
```

Results include:

- `decision`: `allow`, `deny`, or `requires_approval`
- `executed`: whether the command reached the shell
- `stdout` and `stderr`: captured process output
- `exitCode`: the real process exit code when available
- `signal`: terminating signal when applicable
- `cwd`: working directory used for execution
- `durationMs`: elapsed process duration
- `timedOut`: whether the process timed out
- `spawnError`: process spawn failure details when available
- `failureKind`: `policy_denied`, `approval_required`, `spawn_failed`, `process_nonzero`, `process_timeout`, or `process_succeeded`
- `eventId`: the audit event written to the local ledger

Blocked and approval-required commands do not execute.

## Specialist Governance

Specialist governance keeps routing, tool permission checks, delegated execution, and review evidence consistent.

```typescript
import {
  routeSpecialistTask,
  validateSpecialistTool,
  evaluateSpecialistAction,
  delegateSpecialistStep,
  reviewSpecialistResult,
  createEffectGuard,
} from 'safeloop';

const route = routeSpecialistTask({
  objective: 'Run a four-video visual-only MCP pipeline for the Video Director project',
  requiresInfrastructureSupport: true,
});
// route.specialistId === 'video_director'
// route.delegatedSupport === 'coding'

const toolCheck = validateSpecialistTool('sales', 'terminal');
// toolCheck.allowed === false

const action = evaluateSpecialistAction({
  specialistId: 'sales',
  command: 'npm test',
  environment: 'development',
});
// action.decision === 'DENY'
// action.reasonCodes includes 'specialist-tool-not-permitted'
```

Video and media work routes deterministically to `video_director`. Terminal-backed infrastructure work can be delegated to `coding` or `operations`, but the delegated specialist receives a new authorization bound to the task, execution plan, step, specialist, tool, environment, target, and command fingerprint.

`coding`, `operations`, and `video_director` permissions are context-aware: an allowed tool can still be blocked or held for approval because of command risk, production environment, target, or authorization mismatch.

```typescript
const delegated = delegateSpecialistStep({
  fromSpecialistId: 'video_director',
  toSpecialistId: 'coding',
  taskId: 'video-task-1',
  executionPlanId: 'plan-1',
  stepId: 'proxy-setup',
  reason: 'Proxy generation requires terminal-backed setup',
  tool: 'terminal',
  command: 'npm test',
  environment: 'development',
});
```

Reusing an authorization token after changing specialist identity or execution context is rejected with `authorization-context-mismatch`.

Specialist reviews can be minimal:

```typescript
reviewSpecialistResult({
  specialistId: 'video_director',
  reviewerId: 'malu',
  status: 'approved',
  summary: 'Visual review completed.',
  recommendedNextStep: 'Proceed with guarded proxy generation.',
});
```

Or extended with `buildResults`, `testsRun`, `unresolvedIssues`, `artifacts`, and `evidence`. Invalid review payloads return field-level validation errors with the field, expected type, and required status.

## Effect Guard

Use `createEffectGuard` when an integration can mediate externally meaningful effects such as terminal execution, filesystem writes/deletes, external API calls, messages, publishing, deployments, credential changes, DNS changes, purchases, database writes, or production changes.

```typescript
const effects = createEffectGuard({
  registeredAdapters: ['terminal_execute'],
  expectedAdapters: ['terminal_execute', 'deploy'],
});

const result = effects.guardEffect({
  specialistId: 'coding',
  effectClass: 'terminal_execute',
  action: 'run local verification',
  environment: 'development',
  execute: () => 'ok',
});

const coverage = effects.status();
// coverage.knownCoverageGaps includes effect classes without registered adapters
```

If an effect adapter is expected but missing for a production-impacting effect, SafeLoop fails closed instead of claiming coverage it does not have. See [docs/SPECIALIST_GOVERNANCE.md](docs/SPECIALIST_GOVERNANCE.md) for the focused specialist and effect guard guide.

## Scenario Loop

```typescript
import { createScenarioLoop } from 'safeloop';

const loop = createScenarioLoop({
  contract: {
    scenarioId: 'release-check',
    goal: 'ship a verified change',
    successCondition: 'tests pass and evidence is recorded',
    maxAttempts: 5,
    blockedCommands: ['rm -rf'],
    requireApprovalFor: ['git push'],
  },
});

const result = loop.step({
  stepIndex: 0,
  actionType: 'command',
  command: 'npm test',
});
```

Scenario decisions are `continue`, `warn`, `block`, `escalate`, `success`, or `stop`.

## Local Dashboard

SafeLoop includes a local monitor dashboard:

```bash
npm run monitor
# Open http://127.0.0.1:3777
```

Run the dogfood ledger demo:

```bash
npm run dogfood:handoff
npm run monitor:dogfood
# Open http://127.0.0.1:3777
```

The current dashboard is trace-first. It focuses on:

- **Trace Console**: what the agent did, what SafeLoop decided, whether human review was needed, and what evidence was created.
- **Decision Inspector**: selected trace details, decision/status, risk, approval state, evidence, cost/tokens, and redacted raw event JSON.
- **Governance strip**: compact Observe -> Decide -> Approve -> Prove flow.
- **Operational Details**: collapsed diagnostics for loops, costs, approvals, evidence, handoffs, readiness, and oversight.

The monitor serves:

- `GET /api/dashboard`
- `GET /api/timecards/export`
- `GET /health`

The dashboard reads local JSONL. Malformed event lines are skipped instead of crashing the monitor, and skipped-line diagnostics are exposed in monitor diagnostics.

## MCP Support

SafeLoop includes:

- **MCP command gateway**: programmatic API for command checks, governed command execution, activity recording, and status.
- **MCP stdio server**: JSON-RPC stdio server for MCP hosts.

Run the gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

Start the stdio server:

```bash
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

MCP hosts should call `safeloop.checkCommand` or `safeloop.runCommand` instead of raw command tools when SafeLoop governance is required. The same cooperative boundary applies: actions outside SafeLoop's tools are outside SafeLoop's enforcement path.

When a caller provides `specialistId`, MCP `safeloop.checkCommand` and `safeloop.runCommand` share the same specialist permission evaluation. A specialist denied terminal access, such as `sales`, is denied consistently in both preflight and execution.

See [docs/CONNECTORS.md](docs/CONNECTORS.md) for connector and MCP details.

## Event Ledger

SafeLoop writes local events to:

```text
.safeloop/events.jsonl
```

The event ledger is intentionally simple and local. SafeLoop accepts explicit events such as:

- `task.started`
- `decision.made`
- `decision.explained`
- `risk.detected`
- `approval.requested`
- `approval.resolved`
- `artifact.changed`
- `token.cost`
- `model.usage`
- `handoff.created`
- `task.completed`
- `feedback.recorded`

Malformed JSONL lines are skipped during reads; valid events before and after a malformed line are preserved.

## Current Branch Verification

Current local verification for this branch includes:

- `npm test`: 33 suites / 241 tests
- `npm run build`
- `npx tsc --noEmit`

The exact test count can change as coverage is added. Treat these as current branch verification signals, not a permanent compatibility promise.

## Architecture

- Local-first file storage
- TypeScript-native public API
- No runtime cloud dependency
- No database requirement
- MCP stdio support
- Cooperative enforcement boundary
- Dashboard API compatibility through `/api/dashboard`

## Roadmap

- Policy configuration file under `.safeloop/`
- Additional connector guides for more agent runtimes
- Stronger connector install/uninstall workflows
- Larger-ledger dashboard pagination/windowing
- Optional real-time transport after polling limits become real
- v1.0 release checklist and changelog

## Why SafeLoop Exists

Git tracks code. SafeLoop tracks agent work.

- Git answers: "What changed?"
- SafeLoop answers: "What did the agent try? What did SafeLoop decide? Was a human needed? What evidence proves it?"

## License

MIT
