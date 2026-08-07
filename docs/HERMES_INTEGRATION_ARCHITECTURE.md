# Hermes x SafeLoop Integration Architecture

> Status: WSL controlled-pilot integration updated on 2026-08-07  
> SafeLoop baseline: `9d15e4c` plus one reproduced Core defect fix for poisoned-memory detection  
> Hermes: `v0.17.0 (2026.6.19)`, commit `190e1ffac976ee5fc41c9f1845ba8fd886a827b1`

## Confirmed Topology

Hermes and SafeLoop are both running from WSL Ubuntu.

| Component | Path |
| --- | --- |
| Hermes command | `/home/charleszeller/.local/bin/hermes` |
| Hermes repo | `/home/charleszeller/.hermes/hermes-agent` |
| Hermes config | `/home/charleszeller/.hermes/config.yaml` |
| SafeLoop repo | `/home/charleszeller/safeloop-pilot` |
| SafeLoop MCP server | `node /home/charleszeller/safeloop-pilot/dist/cli.js mcp serve` |
| Pilot ledger | `/home/charleszeller/safeloop-pilot/.safeloop-hermes-pilot/.safeloop/events.jsonl` |

SafeLoop MCP doctor passes and finds the WSL Hermes config. Hermes also has a SafeLoop MCP block pointing to the WSL SafeLoop server.

## MCP Alone Is Not Binding Governance

Exposing SafeLoop as an MCP server is useful but insufficient by itself. Hermes v0.17.0 has enabled built-in direct tools that do not need MCP to create side effects:

- `terminal`
- `file`
- `code_execution`
- `web`
- `browser`
- `memory`
- `delegation`
- `cronjob`
- `computer_use`

Source inspection confirms official Hermes model-called tools flow through `tools.registry.ToolRegistry.dispatch()` and Hermes execution middleware. Agent-level tools such as `memory` and `delegate_task` also pass through `run_tool_execution_middleware()` before execution. Therefore the pilot adapter must wrap Hermes tool execution, not merely expose SafeLoop as another optional MCP tool.

## Hermes-Side Adapter

A bundled Hermes plugin was added at:

```text
/home/charleszeller/.hermes/hermes-agent/plugins/safeloop_guard
```

Plugin status:

```text
enabled bundled 0.1.0 safeloop-guard
```

The plugin is still opt-in at runtime. Verification confirmed that unset or `0` leaves enforcement disabled, and `1` enables pre-execution enforcement. It only enforces when:

```bash
SAFELOOP_HERMES_GUARD=1
```

Main environment controls:

```bash
SAFELOOP_HERMES_CLI=/home/charleszeller/safeloop-pilot/dist/cli.js
SAFELOOP_HERMES_BASE_DIR=/home/charleszeller/safeloop-pilot/.safeloop-hermes-pilot
SAFELOOP_HERMES_TENANT=local-pilot
SAFELOOP_HERMES_TIMEOUT_SECONDS=5
SAFELOOP_HERMES_MEMORY_POLICY=allow_with_ttl
```

## Enforcement Flow

```text
Hermes tool call
  -> safeloop-guard tool_execution middleware
  -> normalize tool/action/target/arguments hash
  -> node dist/cli.js governance evaluate|memory --stdin --record
  -> SafeLoop returns disposition
  -> Hermes executes only on ALLOW / allowed memory decision
```

The adapter does not duplicate SafeLoop policy logic. It only normalizes Hermes calls and honors SafeLoop dispositions.

## Governed Pilot Tool Classes

The adapter governs these toolsets or tools before execution:

- terminal and subprocess actions
- file reads/searches/writes/patches through model-called file tools
- code execution
- memory tool writes before durable persistence
- delegation
- cron jobs
- web/browser/computer-use tools
- dynamically registered MCP tools by `mcp-*` toolset

## Memory Governance

Hermes `memory` writes are routed through SafeLoop `governance memory` before Hermes persistence. The adapter honors:

- `ALLOW`
- `ALLOW_WITH_TTL`
- `MERGE`
- `QUARANTINE`
- `REQUIRE_REVIEW`
- `REJECT`

A reproduced SafeLoop defect was found and fixed: candidate memory containing governance-bypass instructions such as â€œignore SafeLoopâ€ or â€œbypass approvalâ€ was not quarantined. SafeLoop now quarantines those candidate memories before persistence.

## Remaining Bypass Limitations

The pilot plugin covers model-called Hermes tools that pass through middleware. Some internal Hermes maintenance/sidecar process paths still exist and were not proven fully governed:

- gateway maintenance subprocesses
- platform bridge sidecars
- browser/voice/transcription helper subprocesses
- direct manual shell actions outside Hermes
- code or tools that bypass Hermes plugin middleware entirely

For production PASS, those paths must be either wrapped, disabled, or proven non-consequential for the deployment profile.

## Honest Boundary

SafeLoop governs Hermes actions and durable candidate memories routed through the SafeLoop adapter, SafeLoop MCP gateway, or SafeLoop APIs. It is cooperative governance, not OS-level sandboxing. Tools, users, or processes that bypass Hermes and SafeLoop can bypass SafeLoop controls.
