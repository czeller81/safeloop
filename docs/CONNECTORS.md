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
- `guardEffect` through an integration that registers an effect adapter
- a specialist delegation path that records `specialist.delegated` before execution
- a runtime hook that calls SafeLoop before executing a command

SafeLoop does not provide OS-level sandboxing by itself. Direct shell calls, direct file writes, direct API calls, direct network calls, publishing, messaging, deployments, private agent tools, and process launches that bypass SafeLoop also bypass SafeLoop guardrails. Use an OS sandbox, container, VM, or system policy layer when non-cooperative containment is required.

## Quick Start

Check connector status:

```bash
npx ts-node examples/connector-status-demo.ts
```

Run a command through SafeLoop:

```bash
npx ts-node examples/safeloop-command.ts --command "echo hello" --agent-id my-agent
```

Or use the package CLI against `.safeloop/policy.json`:

```bash
npx safeloop init
npx safeloop check --command "rm -rf ."
npx safeloop run --command "echo hello"
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
npx safeloop mcp serve
```

Check MCP/Hermes compatibility:

```bash
npx safeloop mcp doctor --host hermes
npx safeloop mcp print-config hermes
npx safeloop mcp mcporter
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
- `safeloop.status`: return gateway status, boundary information, and enforcement diagnostics.

When input includes `specialistId`, `safeloop.checkCommand` and `safeloop.runCommand` share the same specialist permission evaluation. For example, `sales` cannot use `terminal`; both preflight and execution return denial with `specialist-tool-not-permitted`.

`safeloop.runCommand` returns richer `CommandGuard` diagnostics:

- `stdout`
- `stderr`
- `exitCode`
- `signal`
- `cwd`
- `durationMs`
- `timedOut`
- `spawnError`
- `failureKind`

`failureKind` distinguishes policy denial, approval required, spawn failure, nonzero process exit, timeout, and success.

Run the gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

The gateway records events in the same local `.safeloop/events.jsonl` ledger.
Its status response includes `enforcementDiagnostics` with registered adapters, expected adapters, known coverage gaps, and an explicit cooperative-boundary statement.

## MCP Stdio Server

The stdio server exposes SafeLoop tools through MCP JSON-RPC over stdin/stdout. Stdout is reserved for protocol responses; server logging goes to stderr.

Start it directly:

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

Configure the host to use `safeloop.checkCommand` or `safeloop.runCommand` instead of raw command execution tools when SafeLoop governance is required. Calls made through other host tools are outside SafeLoop's enforcement boundary.

For specialist-aware hosts, pass `specialistId`, `taskId`, `executionPlanId`, `stepId`, `environment`, and `target` where available. Those fields help SafeLoop bind decisions and delegated authorizations to the actual execution context.

## Hermes MCP Setup

SafeLoop can print a Hermes `mcp_servers` block:

```bash
npx safeloop mcp print-config hermes
```

Run the doctor:

```bash
npx safeloop mcp doctor --host hermes
```

The doctor validates SafeLoop MCP initialize, tool discovery, status response, dangerous-command denial, local build readiness, and whether the usual Hermes config path exists.

MCPorter can be used as a diagnostic bridge when Hermes configuration is unclear:

```bash
npx safeloop mcp mcporter
```

This prints `mcporter` commands for listing, schema inspection, status calls, and command checks. SafeLoop does not require MCPorter at runtime.

For district appliances, treat MCPorter as a setup and troubleshooting tool, not a production dependency. Once Hermes can see SafeLoop tools, configure governed workflows to call SafeLoop directly and remove or restrict unmanaged command tools where possible.

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
- Specialist-aware MCP calls that include `specialistId`
- Effects routed through `guardEffect`
- Registered connector/runtime adapters that call SafeLoop before performing an effect
- Hermes `spawnPowerShell` calls when the SafeLoop hook is installed and enabled

Cannot govern by itself:

- Direct `child_process.exec()` or `spawn()` calls
- Internal Node.js APIs
- Direct file system writes
- Direct file system deletes
- Direct network requests
- Direct external API writes
- Direct messages or customer communications
- Publishing, deployments, DNS changes, credential changes, purchases, and production changes that bypass SafeLoop
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

### Specialist Routing and Permissions

```typescript
import {
  routeSpecialistTask,
  validateSpecialistTool,
  evaluateSpecialistAction,
} from 'safeloop';

const route = routeSpecialistTask({
  objective: 'Run a four-video visual-only MCP pipeline',
});
// route.specialistId === 'video_director'

const tool = validateSpecialistTool('sales', 'terminal');
// tool.allowed === false

const decision = evaluateSpecialistAction({
  specialistId: 'sales',
  command: 'npm test',
  environment: 'development',
});
// decision.decision === 'DENY'
```

`video_director` is preferred for video/media work. Terminal-backed support can be delegated to `coding` or `operations`; do not silently replace the evaluated specialist identity during execution.

### Delegated Specialist Step

```typescript
import { delegateSpecialistStep } from 'safeloop';

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

The delegated authorization is bound to the specialist, task, execution plan, step, tool, environment, target, and command fingerprint. Reusing it after changing context is rejected.

### Effect Guard

```typescript
import { createEffectGuard } from 'safeloop';

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
```

`coverage.registeredAdapters` shows mediated effects. `coverage.expectedAdapters` shows effects the integration expects to mediate. `coverage.knownCoverageGaps` shows effect classes without registered adapters. Production-impacting effects fail closed when an expected adapter is missing.

See [SPECIALIST_GOVERNANCE.md](SPECIALIST_GOVERNANCE.md) for the focused specialist governance and effect guard guide.

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
npx ts-node examples/codex-governed-workflow-demo.ts
```

For Codex-specific local governance guidance, see [CODEX.md](CODEX.md). The Codex demo labels Codex as an agent actor and routes representative actions through SafeLoop; it does not call OpenAI APIs or claim private-tool interception.

## Future Hardening

- Compiled CLI path for faster startup than `npx ts-node`
- Policy configuration file under `.safeloop/`
- Connector install/uninstall workflows
- Additional connector guides for more agent runtimes
- Connector health checks that detect expected routing gaps
- Optional stronger runtime wrappers outside SafeLoop Core
- Offline appliance profile for Hermes plus SafeLoop, including MCP config checks, blocked raw-tool detection, and district deployment diagnostics
