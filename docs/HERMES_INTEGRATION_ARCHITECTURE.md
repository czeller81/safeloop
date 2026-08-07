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

## Final Certification Coverage - 2026-08-07

### Enabled Path Classification

| Path | Source file | Function/class | Consequential? | SafeLoop-governed in pilot? | Disabled for pilot? | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Model-called tool dispatcher | `agent/tool_executor.py` | `execute_tool_calls_concurrent`, `_run_agent_tool_execution_middleware` | Yes | Yes | No | `run_tool_execution_middleware()` wraps `_invoke_tool()` before the handler executes |
| Tool middleware chain | `hermes_cli/middleware.py` | `run_tool_execution_middleware`, `_run_execution_chain` | Yes | Yes | No | Middleware calls `next_call()` only after SafeLoop plugin permits execution |
| Terminal/shell | `tools/terminal_tool.py` | `_handle_terminal`, `terminal_tool` | Yes | Yes | No | Registered as `terminal` in toolset `terminal`; live destructive command was denied before execution |
| Filesystem tools | `tools/file_tools.py` | `_handle_read_file`, `_handle_write_file`, `_handle_patch`, `_handle_search_files` | Yes | Yes | No | Registered in toolset `file`; isolated lifecycle read/write passed through SafeLoop |
| Git via terminal | `tools/terminal_tool.py` | terminal command handler | Yes | Yes | No | Live `git commit` was stopped with `REQUIRE_APPROVAL` before execution |
| Code execution | `tools/code_execution_tool.py` | registered `execute_code` handler | Yes | Yes by tool name/toolset | Not enabled in final live lifecycle | Plugin governs `execute_code` and `code_execution`; not exercised in final restricted pilot |
| MCP dispatch | `tools/mcp_tool.py` | dynamic registry registration | Yes when MCP tool mutates state | Yes by `mcp-*` toolset | Not enabled in final live lifecycle | Dynamic MCP tools register with `toolset_name` beginning `mcp-`; plugin governs that prefix |
| Memory tool | `tools/memory_tool.py` | registered `memory` handler | Yes for durable writes | Intended yes; live persistence unavailable | No | Plugin calls `governance memory` before `memory`; runtime reported memory unavailable |
| Delegation | `tools/delegate_tool.py` | registered `delegate_task` handler | Yes | Yes by tool name/toolset | Not enabled in final live lifecycle | Plugin governs `delegate_task` and `delegation` |
| Cron jobs | `tools/cronjob_tools.py` | registered cron tool handlers | Yes | Yes by toolset | Not enabled in final live lifecycle | Plugin governs `cronjob`; not exercised in restricted pilot |
| Browser/web/computer-use | `tools/browser_tool.py`, `tools/web_tools.py`, `tools/computer_use/*` | registered browser/web/computer-use handlers | Yes when external writes/actions occur | Yes by toolset | Not enabled in final live lifecycle | Plugin governs `browser`, `web`, and `computer_use`; restricted pilot excluded them |
| CLI setup/update/gateway/service helpers | `hermes_cli/main.py`, `hermes_cli/gateway.py`, `hermes_cli/service_manager.py`, `hermes_cli/setup.py` | CLI command handlers and service helpers | Potentially yes | Not by model tool middleware | Not globally disabled | Out of restricted pilot path; remains a production-profile limitation |
| Browser/voice/TTS/STT helper subprocesses | `tools/browser_tool.py`, `tools/voice_mode.py`, `tools/tts_tool.py`, `tools/transcription_tools.py` | helper launchers | Potentially yes | Only when reached through governed tool call | Not enabled in final live lifecycle | Sidecar/helper subprocesses were not broadly wrapped outside their tool handlers |
| Manual external shell/processes | outside Hermes | N/A | Yes | No | N/A | Outside SafeLoop routed-action boundary |

### Final Certification Meaning

`PASS_WITH_LIMITATIONS` means SafeLoop governed the configured Hermes model-called pilot tool boundary for deterministic local actions, including read/write, shell verification, Git approval hold, destructive denial, and fail-closed outage behavior. It does not mean universal OS interception, and it does not certify every Hermes CLI maintenance or sidecar path for production deployment.

