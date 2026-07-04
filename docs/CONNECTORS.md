# SafeLoop Agent Connectors

> Connect your agent. Guard its actions. Prove what happened.

SafeLoop provides a local connector system so any AI agent can be governed in minutes. Agents route their shell commands through SafeLoop before execution. SafeLoop evaluates each command against policy, blocks dangerous actions, holds approval-required actions, and produces an auditable evidence trail.

---

## Quick Start

### 1. Check connector status

```bash
npx ts-node examples/connector-status-demo.ts
```

This shows which connectors are available and their current status.

### 2. Run a command through SafeLoop (execute mode)

```bash
npx ts-node examples/safeloop-command.ts --command "echo hello" --agent-id my-agent
```

SafeLoop evaluates the command, executes it if allowed, and returns structured JSON:

```json
{
  "decision": "allow",
  "executed": true,
  "exitCode": 0,
  "output": "hello",
  "eventId": "guard-allowed-..."
}
```

### 3. Preflight check (does not execute)

```bash
npx ts-node examples/safeloop-command.ts --check-only --command "rm -rf ." --agent-id my-agent
```

Returns the policy decision without executing:

```json
{
  "decision": "deny",
  "executed": false,
  "violations": ["blocked command: rm -rf ."]
}
```

---

## Generic CLI Connector

Any agent that can call a shell command can connect to SafeLoop.

### Execute mode

Route every command through:

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

### Check-only preflight mode

Evaluate without executing:

```bash
npx ts-node examples/safeloop-command.ts \
  --check-only \
  --command "<COMMAND>" \
  --agent-id <AGENT_ID>
```

### Exit codes

| Code | Meaning |
|:----:|---------|
| `0`  | Allowed and executed successfully (or allowed in check-only mode) |
| `2`  | Invalid CLI input (missing --command) |
| `10` | Blocked by SafeLoop policy |
| `20` | Approval required — command held |
| Other | Allowed command ran but the command itself returned non-zero |

### Default policy

The CLI wrapper ships with a default policy:

**Blocked commands:**
- `rm -rf`
- `sudo rm`
- `del /s`
- `Remove-Item -Recurse -Force`
- `DROP TABLE`

**Requires approval:**
- `git push`
- `deploy`
- `npm publish`

You can customize the policy by modifying `examples/safeloop-command.ts` or creating your own wrapper using `createCommandGuard()` from the SafeLoop SDK.

---

## Hermes Connector

The Hermes connector detects a local Hermes agent installation and reports integration status.

### Detection

The connector checks:

1. `~/.hermes/hermes-agent/apps/desktop/electron/bootstrap-runner.cjs` exists
2. Whether the `SAFELOOP_HERMES_POWERSHELL_GUARD` patch marker is present in the file
3. Whether a `.safeloop-backup` copy exists
4. Whether the `SAFELOOP_HERMES_POWERSHELL_GUARD` environment variable is set

### Integration path

When fully connected, Hermes routes PowerShell commands through SafeLoop's preflight check before execution via the patched `spawnPowerShell` function in `bootstrap-runner.cjs`.

### Environment variable

```bash
set SAFELOOP_HERMES_POWERSHELL_GUARD=1
```

When set, the patched bootstrap-runner calls SafeLoop's CLI in check-only mode before executing PowerShell commands. If SafeLoop returns `deny` or `requires_approval`, the command is blocked.

### Patch backup

When the SafeLoop patch is applied to `bootstrap-runner.cjs`, the original file is saved as:

```
bootstrap-runner.cjs.safeloop-backup
```

This allows clean rollback if needed.

### Check status

```bash
npx ts-node examples/connector-status-demo.ts
```

Example output when Hermes is detected but not yet patched:

```
Hermes Connector:
  Found: true
  Connected: false
  Mode: observer
  Notes:
    • SafeLoop preflight patch NOT detected in bootstrap-runner.cjs.
    • Honest boundary: only spawnPowerShell path is coverable.
```

---

## What SafeLoop Can and Cannot Intercept

### Connector vs Runtime Hook

A **connector** provides detection, status reporting, integration instructions, and an adoption path. It makes SafeLoop easy to connect to.

A **runtime hook** is the actual command/file/git execution path routed through SafeLoop. Enforcement happens only at the runtime hook — not at the connector level.

| Layer | What It Does | Enforces? |
|-------|-------------|:-:|
| Connector | Detects agent, reports status, documents integration | No |
| CLI Wrapper (`safeloop-command.ts`) | Evaluates + executes commands through guard | **Yes** |
| CommandGuard API (`guard.run()`) | Blocks before shell execution | **Yes** |
| Hermes patch (spawnPowerShell + env flag) | Preflights PowerShell commands | **Yes** |
| Agent calling commands directly | Bypasses SafeLoop entirely | No |

**Key principle:** Connectors make SafeLoop easy to adopt. They do not magically intercept private agent runtimes. Real enforcement begins when an agent routes actions through SafeLoop.

### Can intercept (when agent uses the guard)

- Shell commands routed through `safeloop-command.ts`
- PowerShell commands via Hermes `spawnPowerShell` (when patch is applied)
- Any command passed through `createCommandGuard().run()`
- Any scenario step passed through `createScenarioLoop().step()`

### Cannot intercept

- Direct `child_process.exec()` or `spawn()` calls that bypass SafeLoop
- Internal Node.js API calls within an agent
- Network requests made directly by agent code
- File system operations not routed through the guard
- Hermes execution paths other than `spawnPowerShell` (e.g., internal tool calls, direct Node APIs)

### Honest boundary statement

SafeLoop Core is a **cooperative enforcement layer**. It can only govern actions that agents voluntarily route through the SafeLoop guard. The enforcement is real (blocked commands never reach the shell), but the boundary requires agent cooperation.

For full interception without cooperation, a system-level sandbox or proxy would be required. That is outside SafeLoop Core's current scope.

---

## Programmatic API

### createCommandGuard()

```typescript
import { createCommandGuard } from 'safeloop';

const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    blockedCommands: ['rm -rf', 'DROP TABLE'],
    requireApprovalFor: ['git push', 'deploy'],
  },
  agentId: 'my-agent',
  agentName: 'MyAgent',
  storageOptions: { baseDir: '/path/to/project' },
});

const result = guard.run('echo hello');
// result.decision: 'allow' | 'deny' | 'requires_approval'
// result.executed: boolean
```

### createScenarioLoop()

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
// result.decision: 'continue' | 'block' | 'escalate' | 'success' | 'stop'
```

### Connector detection

```typescript
import { createGenericCliConnector, createHermesConnector } from 'safeloop';

const generic = createGenericCliConnector();
console.log(generic.detect());  // { found: true, path: '...', notes: [...] }
console.log(generic.status());  // { connected: true, mode: 'execute-wrapper', ... }

const hermes = createHermesConnector();
console.log(hermes.detect());   // { found: true/false, ... }
console.log(hermes.verify());   // { ok: true/false, checks: [...] }
```

---

## Kiro Governance Roadmap

Kiro (the AI coding agent in this workspace) is not currently governed by SafeLoop unless explicitly configured. Its internal `execute_bash`, file edit, and git tools run directly without SafeLoop preflight.

### Phase 1: Cooperative steering (smallest step)

Add a `.kiro/steering/` file instructing Kiro to preflight shell commands through `safeloop-command.ts --check-only` before execution. This is advisory — Kiro reads steering but its tools still execute directly.

### Phase 2: SafeLoop MCP command tool

Create a SafeLoop MCP server that Kiro calls instead of raw `execute_bash`. This would be a real enforcement point because Kiro would use SafeLoop as its primary command execution tool.

### Phase 3: File/git activity event adapter

Emit SafeLoop events for file edits and git operations so the Evidence Stream and audit trail capture all Kiro work, not just shell commands.

### Phase 4: Stronger runtime wrapper

System-level shell wrapping or sandbox integration that intercepts all command execution regardless of which tool is used. This provides non-cooperative enforcement but requires infrastructure changes.

### Current honest status

Kiro is governed by SafeLoop **only when it voluntarily calls `safeloop-command.ts`**. Without steering or MCP integration, Kiro's normal operation bypasses SafeLoop entirely.

---

## Future Hardening

The current connector layer is a v1 foundation. Planned improvements:

1. **Compiled JS CLI** — replace `npx ts-node` with a pre-compiled `safeloop` binary for faster cold-start
2. **Scan all exec/spawn paths** — detect and optionally wrap all shell execution points in an agent's codebase
3. **One-command connector install/uninstall** — `safeloop connect hermes` / `safeloop disconnect hermes`
4. **Policy configuration file** — `.safeloop/policy.json` for per-project policy rules
5. **Connector health monitoring** — detect when a connected agent starts bypassing the guard
6. **Multiple agent support** — dashboard shows all connected agents and their connector status

---

## Demo Commands

```bash
# Check connector status
npx ts-node examples/connector-status-demo.ts

# Run safe command (execute mode)
npx ts-node examples/safeloop-command.ts --command "echo hello" --agent-id hermes

# Run dangerous command (blocked)
npx ts-node examples/safeloop-command.ts --command "rm -rf ." --agent-id hermes

# Check-only preflight (does not execute)
npx ts-node examples/safeloop-command.ts --check-only --command "git push origin master" --agent-id hermes

# Run scenario loop demo
npx ts-node examples/scenario-loop-demo.ts

# Run command guard demo
npx ts-node examples/command-guard-demo.ts
```
