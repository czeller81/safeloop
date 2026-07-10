# SafeLoop

**Local-first agent governance SDK and dashboard for AI-assisted work.**

SafeLoop helps teams observe agent work, route risky actions through guardrails, request human approval, and preserve audit evidence in a local ledger.

> Observe. Decide. Approve. Prove.

## What SafeLoop Is

SafeLoop is an open-source, local-first TypeScript toolkit for cooperative AI agent governance:

- **Command guard / circuit breaker**: allow, block, or hold shell commands before execution when agents route commands through SafeLoop.
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

SafeLoop does **not** automatically intercept private agent tools, direct shell calls, direct file writes, network requests, or process launches that bypass SafeLoop. Agents and MCP hosts must be configured to use SafeLoop's command guard, CLI wrapper, MCP tools, or connector runtime hook. For non-cooperative containment, use an OS-level sandbox, container, VM, or system policy layer in addition to SafeLoop.

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
- `eventId`: the audit event written to the local ledger

Blocked and approval-required commands do not execute.

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

- `npm test`: 32 suites / 227 tests
- `npm run build`
- `npm run build:ui`

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
