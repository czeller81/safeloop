# SafeLoop Connectors and MCP

> Connect your agent. Guard its actions. Prove what happened.

SafeLoop provides a local connector and MCP foundation for cooperative agent governance. Agents and MCP hosts can route shell commands through SafeLoop so commands are checked before execution and recorded in the local audit ledger.

## Boundary First

SafeLoop connectors are not magic interception layers.

SafeLoop can enforce decisions only when the action is routed through one of these paths:

- `createCommandGuard().run()`
- `examples/safeloop-command.ts`
- `safeloop.runCommand` through the MCP gateway or stdio server
- `createScenarioLoop().step()` for command steps
- a runtime hook that calls SafeLoop before executing a command

SafeLoop does not provide OS-level sandboxing by itself. Direct shell calls, direct file writes, direct network calls, private agent tools, and process launches that bypass SafeLoop also bypass SafeLoop guardrails. Use an OS sandbox, container, VM, or system policy layer when non-cooperative containment is required.

## Quick Start

Check connector status:

```bash
npx ts-node examples/connector-status-demo.ts
```

Run a command through SafeLoop:

```bash
npx ts-node examples/safeloop-command.ts --command "echo hello" --agent-id my-agent
```

Preflight without executing:

```bash
npx ts-node examples/safeloop-command.ts --check-only --command "rm -rf ." --agent-id my-agent
```

Run the MCP gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

Start the MCP stdio server:

```bash
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

## Generic CLI Connector

The generic CLI connector works with any agent that can call a shell command.

Execute mode:

```bash
npx ts-node examples/safeloop-command.ts \
  --command "<COMMAND>" \
  --agent-id <AGENT_ID> \
  --agent-name <AGENT_NAME> \
  --case-id <CASE_ID> \
  --task-id <TASK_ID> \
  --task-name "<TASK_NAME>" \
  --base-dir <PROJECT_DIR>
```

Check-only mode:

```bash
npx ts-node examples/safeloop-command.ts \
  --check-only \
  --command "<COMMAND>" \
  --agent-id <AGENT_ID>
```

Exit codes:

| Code | Meaning |
|:----:|---------|
| `0` | Allowed and executed successfully, or allowed in check-only mode |
| `2` | Invalid CLI input |
| `10` | Blocked by SafeLoop policy |
| `20` | Approval required and command held |
| Other | Allowed command ran and returned its own non-zero exit code |

Default blocked command patterns:

- `rm -rf`
- `sudo rm`
- `del /s`
- `Remove-Item -Recurse -Force`
- `DROP TABLE`

Default approval-required patterns:

- `git push`
- `deploy`
- `npm publish`

## MCP Command Gateway

The MCP gateway is a local API wrapper around SafeLoop command governance.

Available tools:

- `safeloop.checkCommand`: preflight a command without executing it.
- `safeloop.runCommand`: execute a command through `CommandGuard`.
- `safeloop.recordActivity`: record an audit-only activity event.
- `safeloop.status`: return gateway status and boundary information.

Run the gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

The gateway records events in the same local `.safeloop/events.jsonl` ledger.

## MCP Stdio Server

The stdio server exposes SafeLoop tools through MCP JSON-RPC over stdin/stdout. Stdout is reserved for protocol responses; server logging goes to stderr.

Start it directly:

```bash
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

Example MCP host configuration shape:

```json
{
  "mcpServers": {
    "safeloop": {
      "command": "npx",
      "args": ["ts-node", "examples/safeloop-mcp-stdio-server.ts"]
    }
  }
}
```

Configure the host to use `safeloop.checkCommand` or `safeloop.runCommand` instead of raw command execution tools when SafeLoop governance is required. Calls made through other host tools are outside SafeLoop's enforcement boundary.

## Hermes Connector

The Hermes connector currently detects a local Hermes agent installation and reports whether the known PowerShell execution path appears to be patched for SafeLoop preflight.

Detection checks:

1. `~/.hermes/hermes-agent/apps/desktop/electron/bootstrap-runner.cjs`
2. `SAFELOOP_HERMES_POWERSHELL_GUARD` patch marker
3. `.safeloop-backup` file
4. `SAFELOOP_HERMES_POWERSHELL_GUARD` environment variable

When configured, the Hermes `spawnPowerShell` path can preflight commands before execution. Other Hermes execution paths are not covered unless they are separately routed through SafeLoop.

Set the environment variable on Windows:

```bat
set SAFELOOP_HERMES_POWERSHELL_GUARD=1
```

Check status:

```bash
npx ts-node examples/connector-status-demo.ts
```

## What SafeLoop Can Govern

Can govern when routed through SafeLoop:

- Shell commands passed to `safeloop-command.ts`
- Shell commands passed to `createCommandGuard().run()`
- MCP `safeloop.runCommand` calls
- Scenario loop command steps
- Hermes `spawnPowerShell` calls when the SafeLoop hook is installed and enabled

Cannot govern by itself:

- Direct `child_process.exec()` or `spawn()` calls
- Internal Node.js APIs
- Direct file system writes
- Direct network requests
- Agent tools that do not call SafeLoop
- Hermes execution paths other than the covered `spawnPowerShell` path

## Programmatic API

### Command Guard

```typescript
import { createCommandGuard } from 'safeloop';

const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    blockedCommands: ['rm -rf', 'DROP TABLE'],
    requireApprovalFor: ['git push', 'deploy'],
  },
  agentId: 'my-agent',
  agentName: 'My Agent',
  storageOptions: { baseDir: '/path/to/project' },
});

const result = guard.run('echo hello');
```

### Scenario Loop

```typescript
import { createScenarioLoop } from 'safeloop';

const loop = createScenarioLoop({
  contract: {
    scenarioId: 'my-scenario',
    goal: 'produce verified result',
    successCondition: 'all tests pass',
    maxAttempts: 5,
    blockedCommands: ['rm -rf'],
    requireApprovalFor: ['git push'],
  },
  storageOptions: { baseDir: '/path/to/project' },
});

const result = loop.step({
  stepIndex: 0,
  actionType: 'command',
  command: 'npm test',
});
```

### Connector Detection

```typescript
import { createGenericCliConnector, createHermesConnector } from 'safeloop';

const generic = createGenericCliConnector();
console.log(generic.detect());
console.log(generic.status());

const hermes = createHermesConnector();
console.log(hermes.detect());
console.log(hermes.verify());
```

## Examples

```bash
npx ts-node examples/command-guard-demo.ts
npx ts-node examples/scenario-loop-demo.ts
npx ts-node examples/connector-status-demo.ts
npx ts-node examples/safeloop-mcp-gateway-demo.ts
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

## Future Hardening

- Compiled CLI path for faster startup than `npx ts-node`
- Policy configuration file under `.safeloop/`
- Connector install/uninstall workflows
- Additional connector guides for more agent runtimes
- Connector health checks that detect expected routing gaps
- Optional stronger runtime wrappers outside SafeLoop Core
