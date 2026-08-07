# SafeLoop and Claude

SafeLoop is not a Claude replacement and does not use a private Anthropic API. Claude, Claude Code, and Claude Desktop are possible agent or MCP host actors that can route commands and effects through SafeLoop.

## What This Guide Covers

This guide explains the recommended cooperative integration pattern for Claude-based local agent workflows:

- use SafeLoop as the local command guard and audit ledger
- expose SafeLoop through MCP stdio where the Claude host supports MCP
- route shell commands through `safeloop.checkCommand` or `safeloop.runCommand`
- emit explicit activity, decision, approval, evidence, token, and cost events
- monitor the local ledger with the SafeLoop dashboard

## Recommended Claude Integration Pattern

Configure Claude workflows so production-impacting actions go through one of:

- `safeloop.checkCommand`
- `safeloop.runCommand`
- `safeloop.recordActivity`
- `examples/safeloop-command.ts`
- `createCommandGuard().run()`
- `guardEffect` through a registered adapter
- the Agent Adapter Protocol with `agentType: "claude-code"`

Direct Claude tool calls that bypass SafeLoop are outside SafeLoop's enforcement boundary.

## MCP Stdio Setup

Build SafeLoop first:

```bash
npm install
npm run build
```

Start the SafeLoop MCP stdio server:

```bash
npx safeloop mcp serve
```

Example MCP host configuration shape:

```json
{
  "mcpServers": {
    "safeloop": {
      "command": "npx",
      "args": ["safeloop", "mcp", "serve"]
    }
  }
}
```

If you are developing from source instead of an installed package, use the source entrypoint:

```bash
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

SafeLoop keeps MCP stdout reserved for JSON-RPC protocol responses. Logs go to stderr so stdio behavior stays clean.

## Available MCP Tools

SafeLoop exposes:

- `safeloop.checkCommand`: check a command without executing it
- `safeloop.runCommand`: execute a command through SafeLoop CommandGuard
- `safeloop.recordActivity`: record an audit-only event
- `safeloop.status`: report gateway status and diagnostics

Example dangerous-command preflight:

```json
{
  "command": "rm -rf .",
  "agentId": "claude-code",
  "agentName": "Claude Code",
  "specialistId": "coding"
}
```

Expected result: SafeLoop denies the command and records the decision locally.

## Claude Code Adapter Identity

When emitting Agent Adapter Protocol events from a Claude wrapper, use:

```typescript
const adapter = {
  id: 'claude-code-local',
  name: 'Claude Code',
  agentType: 'claude-code',
  capabilities: {
    canReadFiles: true,
    canWriteFiles: true,
    canRunCommands: true,
    canRequestApproval: true,
    canHandoff: true,
    canGenerateReports: true,
  },
};
```

Recommended lifecycle events:

- `task.started`
- `context.loaded`
- `decision.made`
- `risk.detected`
- `approval.requested`
- `approval.resolved`
- `artifact.changed`
- `model.usage`
- `token.cost`
- `handoff.created`
- `task.completed`
- `report.generated`

## Command Guard Example

```typescript
import { createCommandGuard } from 'safeloop';

const guard = createCommandGuard({
  agentId: 'claude-code-local',
  agentName: 'Claude Code',
  storageOptions: { baseDir: process.cwd() },
});

const result = guard.run('npm test', {
  cwd: process.cwd(),
});

console.log(result.decision, result.executed, result.exitCode);
```

Blocked and approval-required guarded commands do not reach the shell.

## Local Dashboard

Start the monitor:

```bash
npm run monitor
```

Open:

```text
http://127.0.0.1:3777
```

For a local demo ledger:

```bash
npm run dogfood:handoff
npm run monitor:dogfood
```

The dashboard shows captured actions, SafeLoop decisions, human review state, risks, evidence, token/cost data, and timecards.

## School District / Offline RAG Use

For school-district local AI systems, initialize the offline RAG policy profile:

```bash
npx safeloop init --profile k12-offline-rag
npx safeloop policy doctor
npx safeloop appliance doctor --profile k12-offline-rag
```

Recommended deployment pattern:

- run Claude or another local agent on the appliance
- configure the agent host to use SafeLoop MCP tools for commands
- keep raw shell, publishing, messaging, and deployment tools unavailable or least-privileged
- store the vector database on approved local storage only
- record document ingestion, approval, evidence, and cost events into the local ledger
- use OS, network, storage, and credential controls for containment

## Honest Enforcement Boundary

SafeLoop is a cooperative local governance layer, not an OS sandbox and not a universal Claude interceptor.

SafeLoop can govern actions routed through:

- SafeLoop CLI commands
- SafeLoop MCP tools
- CommandGuard
- ScenarioLoop
- Agent Adapter Protocol events
- `guardEffect`
- registered connectors and adapters

SafeLoop does not automatically intercept Claude private tools, direct shell access, direct file edits, direct API calls, browser actions, publishing, messaging, deployments, or network access that bypass SafeLoop.

For school districts or other high-trust local deployments, configure Claude and every connected tool so sensitive actions route through SafeLoop, and combine SafeLoop with OS sandboxing, network allowlists, least-privilege accounts, local storage controls, backups, and audit review.

## Troubleshooting

Run:

```bash
npx safeloop mcp doctor
```

If an MCP host cannot see SafeLoop clearly, use MCPorter during setup:

```bash
npx safeloop mcp mcporter
```

SafeLoop does not require MCPorter at runtime.
