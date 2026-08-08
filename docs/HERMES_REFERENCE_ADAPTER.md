# Hermes Reference Adapter

Hermes is the **first reference agent** used to prove the universal runtime
architecture. Hermes is not the architecture, and SafeLoop must not depend on
it. Everything in `src/runtime/` is framework-neutral; everything
Hermes-specific lives in the plugin.

| | |
| --- | --- |
| Hermes version | v0.17.0 (2026.6.19) |
| Hermes upstream commit | `190e1ffac976ee5fc41c9f1845ba8fd886a827b1` |
| Adapter (pre-v0.2) | `53f91ef1dcc4daeb271d0063e49088fa67ce79bd` |
| Adapter (v0.2) | `72773be23` — local-only, **not pushed upstream** |
| Location | `/home/charleszeller/.hermes/hermes-agent/plugins/safeloop_guard/` |
| Certified profile | `coding` |

## What changed in v0.2

### 1. Authorization is bound, not ambient

v0.1 set `hasHumanApproval` from `SAFELOOP_HERMES_APPROVED`. Any process able to
set that variable turned every REQUIRE_APPROVAL into ALLOW, for every action,
for the whole session.

That mechanism is **gone**. A held action now requires a token bound to the
exact action fingerprint, redeemed once, in exchange for an execution permit.

The live proof sets `SAFELOOP_HERMES_APPROVED=1` deliberately and confirms the
commit is still held.

### 2. Managed families execute inside SafeLoop

v0.1 returned "allowed" and let Hermes run the tool via `next_call`, so nothing
tied the decision to the action that actually ran.

Terminal, filesystem, git, and memory now execute through SafeLoop's managed
executors. `next_call` is **never reached** for them. The thing that decides and
the thing that acts are the same thing.

### 3. Git is structured

The adapter parses git command lines into structured operations, so `force_push`
is distinguishable from `push` rather than being an opaque string. Commands that
cannot be modelled faithfully stay governed as ordinary shell actions rather
than being reshaped into something policy treats more leniently.

### 4. Unmanageable tools are denied

`delegate_task`, `execute_code`, `browser`, `computer_use`, `cronjob`, and
`voice_mode` are refused, not passed through. Passing them through would claim
governance over paths SafeLoop does not control.

### 5. Resident runtime

The adapter talks HTTP to a running daemon instead of spawning
`node dist/cli.js` per tool call (~150ms of Node startup before any policy ran).

## Execution path inventory

Audited fresh against the working tree, tracing to real side-effect boundaries.
Grep alone does not prove interception; each row below was checked against where
execution actually happens.

The governed boundary is `agent/tool_executor.py`, which runs
`run_tool_execution_middleware` for model-issued tool calls.

| Path | Source | Consequential | Enabled in certified profile | State |
| --- | --- | --- | --- | --- |
| Terminal / shell | `tools/terminal_tool.py` | yes | yes | **MANAGED** — SafeLoop shell executor |
| Filesystem | `tools/file_operations.py`, `tools/file_tools.py` | yes | yes | **MANAGED** — SafeLoop filesystem executor |
| Git | via terminal | yes | yes | **MANAGED** — parsed into structured git operations |
| Memory | `tools/memory_tool.py` | yes | yes | **MANAGED** — SafeLoop memory gateway |
| MCP tools | `mcp-*` toolsets | yes | no | **DISABLED** — not in the enabled toolset list |
| Code execution | `tools/code_execution_tool.py` | yes | no | **DISABLED** — denied by the adapter |
| Delegation / sub-agents | `tools/delegate_tool.py` | yes | no | **DISABLED** — denied by the adapter |
| Browser | `tools/browser_tool.py`, `browser_camofox.py`, `browser_cdp_tool.py` | yes | no | **DISABLED** — denied by the adapter |
| Computer use | `tools/computer_use_tool.py`, `tools/computer_use/` | yes | no | **DISABLED** — denied by the adapter |
| Cron / scheduling | `tools/cronjob_tools.py`, `cron/scheduler.py` | yes | no | **DISABLED** — denied by the adapter; scheduler not run |
| Messaging | `tools/discord_tool.py`, `feishu_*`, `homeassistant_tool.py` | yes | no | **DISABLED** — not in the enabled toolset list |
| Voice sidecar | `tools/voice_mode.py` | yes | no | **DISABLED** — denied by the adapter; not enabled |
| Background processes | `tools/process_registry.py` | yes | only via terminal | **MANAGED** at the terminal boundary; direct API not reachable from a model-called tool |
| Environment probing | `tools/env_probe.py`, `tools/lazy_deps.py` | low | yes | **UNMANAGED** — non-consequential; probes and dependency loading, no user-visible state change |
| Checkpoint maintenance | `tools/checkpoint_manager.py` | low | yes | **UNMANAGED** — writes only inside Hermes' own state directory |
| Gateway service | `gateway/run.py` | yes | **no** | **DISABLED** — the gateway is not run in the certified configuration |
| Desktop / updater helpers | `apps/desktop/electron/*` | yes | **no** | **DISABLED** — desktop app not run |
| Docker / Singularity envs | `tools/environments/{docker,singularity}.py` | yes | no | **DISABLED** — local environment only |

Two `UNMANAGED` rows remain (`env_probe`/`lazy_deps` and `checkpoint_manager`).
Both are classified **non-consequential**: they do not change user-visible state
outside Hermes' own state directory. Under the rule in
`docs/MANAGED_EXECUTION.md`, only *consequential* UNMANAGED paths block
full-profile certification, so these do not.

**This classification is a judgement, and it is the weakest link in the Hermes
certification.** If either path is later shown to produce a consequential side
effect, the Hermes profile drops to `PASS_WITH_LIMITATIONS`. It is recorded here
rather than buried so that a reviewer can disagree with it.

### The enabled-toolset finding

`/home/charleszeller/.hermes/config.yaml` declares:

```yaml
toolsets:
  - hermes-cli
```

Only the `hermes-cli` toolset is loaded. This is why so many consequential paths
are DISABLED rather than merely denied — and it is also the root cause of pilot
limitation #2, discussed below.

## Live bound-approval proof

`scripts/hermes-bound-approval-proof.py` drives the **actual plugin
middleware** — the same function Hermes calls for every model-issued tool call —
against a real runtime and a disposable git repository under `/tmp`. No mock
stands in for the adapter or the runtime.

**17/17 checks pass.** Evidence: `docs/evidence/hermes-bound-approval-proof.json`.

| Check | Result |
| --- | --- |
| Safe read allowed | executed by SafeLoop |
| Managed write executes | file changed |
| Harmless shell allowed | executed |
| `git status` recognized and allowed | executed |
| Destructive command denied | target intact |
| `git commit` held for approval | no commit |
| `SAFELOOP_HERMES_APPROVED` no longer grants authorization | still held |
| Bound approval executes the exact commit once | 1 commit |
| Approval replay rejected | still 1 commit |
| Changed commit args rejected | no new commit |
| Forged approval rejected | `failure=forged` |
| Expired approval rejected | `failure=expired` |
| Force push denied | DENY |
| Unmanageable path denied | `unmanaged_path` |
| Poisoned memory not activated | blocked |
| Valid memory governed and activated | 1 active memory |
| Runtime outage fails closed | no file written |

## Hermes native memory — limitation resolved and reframed

The pilot recorded that Hermes native durable memory "was not fully demonstrated
because its memory tool was unavailable in that runtime."

**Root cause:** not a Hermes version limitation. `config.yaml` sets
`memory.memory_enabled: true`, but the `memory` toolset is not in the enabled
`toolsets` list, so the tool is never loaded. Hermes v0.17.0 does support
memory.

**Why v0.2 does not simply enable it:** the architecture changed underneath the
question. SafeLoop now performs memory persistence itself and never calls
`next_call` for the memory tool. Hermes' native store is therefore deliberately
not the durable store in this integration — SafeLoop's governed store is. Routing
a candidate through governance and *then* handing it to an ungoverned native
store would reopen the TOCTOU gap v0.2 exists to close.

**What is proven:** the full memory lifecycle — candidate → governance → bound
persistence → retrieval in a later session — through the real adapter, including
that a poisoned candidate is quarantined and never retrievable.

**What is not claimed:** that Hermes' *own* memory subsystem has been certified.
It is not used in this integration. Any future integration that wants Hermes to
own durable storage must call `authorizePersistence()` before activation.

The user's Hermes configuration was **not** modified.

## Change control

- Adapter change is narrow: one file.
- Unrelated local Hermes work preserved (`apps/desktop/electron/bootstrap-runner.cjs`,
  untracked `skills/mcp/`, `skills/vibe-os-operator/`).
- Local commit only. **Nothing pushed upstream.**

## Running it

```bash
safeloop daemon start --profile coding --workspace /path/to/repo
```

```bash
SAFELOOP_HERMES_GUARD=1 safeloop run --profile coding -- hermes
```

`safeloop run` sets `SAFELOOP_RUNTIME_URL`, `SAFELOOP_RUNTIME_CREDENTIAL`,
`SAFELOOP_SESSION_ID`, `SAFELOOP_SESSION_CREDENTIAL`, `SAFELOOP_TASK_ID`,
`SAFELOOP_WORKSPACE`, and `SAFELOOP_PROFILE` for the child. Grant approvals with
`safeloop` or by writing a token to `SAFELOOP_APPROVAL_DIR/<fingerprint>.json`.
