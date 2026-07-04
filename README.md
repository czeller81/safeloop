# SafeLoop Core

**Local AI agent circuit breaker and scenario loop controller.**

SafeLoop helps agents run until correct — while enforcing guardrails and producing audit evidence.

> Connect your agent. Guard its actions. Prove what happened.

---

## What SafeLoop Core Is

SafeLoop is a local runtime and command center for AI agent governance. It is not only observability — it actively controls agent behavior when agents route through its guard.

- **SEE** — Live visibility into agents, tasks, handoffs, tool calls, cost burn.
- **CONTROL** — Block dangerous commands before execution. Hold approval-required actions. Enforce scenario loop contracts.
- **PROVE** — Audit events, billable timecards, export API, connector status, 204 tests.

---

## What SafeLoop Core Proves Today

### Command Guard

```
Agent → SafeLoop Guard → Action
```

Blocked commands never reach the shell. Approval-required commands are held. Only allowed commands execute.

### Scenario Loop

```
Scenario Contract → Dimension-Coded Step → Loop Decision → Guarded Action → Audit Evidence → Continue/Stop
```

Multi-step agent loops are governed with decisions: continue, block, escalate, success, stop.

### Connector Layer

```
Agent Connector → Check-only Preflight → Allow / Deny / Approval
```

External agents connect through a CLI wrapper with execute mode and check-only preflight.

---

## Quick Start

```bash
npm install
npm test -- --no-cache
npm run build
```

### Run demos

```bash
# Command guard proof (allowed / blocked / approval-required)
npx ts-node examples/command-guard-demo.ts

# Scenario loop proof (continue / block / escalate / success / stop)
npx ts-node examples/scenario-loop-demo.ts

# Connector status
npx ts-node examples/connector-status-demo.ts

# Full Command Center governance story
npx ts-node examples/command-center-demo.ts
npm run monitor -- --baseDir .safeloop-command-demo
```

### CLI wrapper

```bash
# Execute mode — runs command through SafeLoop guard
npx ts-node examples/safeloop-command.ts --command "node -e \"console.log('hello')\"" --agent-id my-agent

# Check-only preflight — evaluates without executing
npx ts-node examples/safeloop-command.ts --check-only --command "rm -rf ." --agent-id my-agent

# Approval-required — held, does not execute
npx ts-node examples/safeloop-command.ts --command "git push origin master" --agent-id my-agent
```

Expected:
- Safe command → executed, exit 0
- Dangerous command → blocked, exit 10
- Approval-required → held, exit 20
- Check-only → decision only, never executes

---

## Agent Connectors

SafeLoop includes a connector system so external agents can connect in minutes.

- **Generic CLI connector** — any agent routes commands through `safeloop-command.ts`
- **Hermes connector** — dry-run detection of bootstrap-runner.cjs integration

See **[docs/CONNECTORS.md](docs/CONNECTORS.md)** for full quickstart.

---

## Enforcement Boundary

SafeLoop Core is a cooperative enforcement layer.

It can govern any agent that routes actions through its guard, CLI wrapper, connector, or future MCP tool. Blocked commands never reach the shell — the enforcement is real.

SafeLoop does not automatically intercept an agent's private runtime tools unless that runtime is patched, wrapped, or configured to use SafeLoop. Connectors make SafeLoop easy to adopt. They do not magically intercept private agent runtimes. Real enforcement begins when an agent routes actions through SafeLoop.

It cannot intercept direct shell, file, network, or process actions that bypass SafeLoop. For full non-cooperative interception, a system sandbox or proxy would be required.

**Hermes integration:** The current proof guards the `bootstrap-runner.cjs` `spawnPowerShell` path when `SAFELOOP_HERMES_POWERSHELL_GUARD=1`. Other Hermes exec/spawn paths require separate coverage.

**Kiro integration:** Kiro is not currently governed by SafeLoop unless explicitly instructed to preflight commands through `safeloop-command.ts`. See the Kiro governance roadmap in [docs/CONNECTORS.md](docs/CONNECTORS.md).

---

## Command Center

SafeLoop includes a local monitor dashboard:

```bash
npx ts-node examples/command-center-demo.ts
npm run monitor -- --baseDir .safeloop-command-demo
# Open http://127.0.0.1:3777
```

Features:
- Agent Circuit Map (visual topology)
- Evidence Stream (typed event timeline)
- Operator Console (attention queue, approve/resolve actions)
- Billable Timecard Summary
- Timecard Export API (`GET /api/timecards/export`)
- Local/cloud deployment metadata
- Historical ledger with state preservation

---

## Current Status

### Delivered

- Command Guard (enforced local circuit breaker)
- Scenario Loop (dimension-coded governance)
- `safeloop-command` CLI wrapper
- `--check-only` preflight mode
- Local agent connector foundation
- Connector quickstart docs
- Command Center dashboard
- Agent Circuit Map
- Evidence Stream
- Billable timecards and export API
- UI state preservation (details/scroll survive refresh)
- Mission-control visual upgrade
- 204 tests passing, TypeScript clean, build successful

### Architecture

- Local-first, file-based (`.safeloop/events.jsonl`)
- No cloud service required
- No database required
- No hosted platform
- TypeScript-native
- Zero external runtime dependencies

---

## Next Hardening

- Replace `npx ts-node` preflight with compiled JS CLI entrypoint
- Add one-command connector install/uninstall (`safeloop connect hermes`)
- Scan additional Hermes exec/spawn paths
- Add more agent connectors (OpenCode, Claude Code, Cursor)
- Policy configuration file (`.safeloop/policy.json`)
- Prepare `v1.0.0` release tag and changelog

---

## Why SafeLoop Exists

Git tracks code. SafeLoop tracks agent work.

- Git answers: "What changed?"
- SafeLoop answers: "Why? Who decided? What evidence? What should happen next? Was it allowed?"

---

## License

MIT
