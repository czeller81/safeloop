# SafeLoop and Codex

SafeLoop is not a Codex replacement and does not use a private Codex API. Codex is one possible agent actor that can route commands and effects through SafeLoop.

## What This Branch Provides

Status: DEMO.

This repository includes a local Codex-governed workflow demo:

```bash
npm run demo:codex-governed
```

Equivalent direct command:

```bash
npx ts-node examples/codex-governed-workflow-demo.ts
```

The demo writes to:

```text
.safeloop-codex-demo/.safeloop/events.jsonl
```

It demonstrates:

- a Codex-labeled local agent starting a task
- deterministic specialist routing
- a safe command allowed and executed through the MCP gateway
- a risky publish command held for approval
- a destructive command blocked before execution
- a sales specialist denied terminal access
- a production deploy effect blocked because an expected adapter is missing
- evidence and completion events in the local ledger

## What It Does Not Claim

The demo does not call OpenAI APIs, use a hosted Codex service, or intercept Codex private tools automatically. It is a truthful local proof of how Codex-like agent work should be routed through SafeLoop.

## Recommended Codex Integration Pattern

Configure Codex workflows so shell commands and production-impacting actions go through one of:

- `safeloop.checkCommand`
- `safeloop.runCommand`
- `examples/safeloop-command.ts`
- `createCommandGuard().run()`
- `guardEffect` via a registered adapter

Direct Codex tool calls that bypass SafeLoop are outside SafeLoop's enforcement boundary.

## Example Result Shape

The demo returns JSON including:

- `allowedDecision`
- `allowedExecuted`
- `approvalDecision`
- `approvalExecuted`
- `blockedDecision`
- `blockedExecuted`
- `salesTerminalDecision`
- `deployDecision`
- `deployExecuted`
- `eventCount`
- `eventTypes`

Use the dashboard against the demo ledger:

```bash
npm run monitor -- --baseDir .safeloop-codex-demo
```

Open:

```text
http://127.0.0.1:3777
```
