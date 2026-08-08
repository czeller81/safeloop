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
| Environment probing | `tools/env_probe.py` | no | yes | **UNMANAGED** — read-only `--version` probes via `_run()`: `capture_output`, `stdin=DEVNULL`, 3s timeout, no writes, no network |
| Lazy dependency install | `tools/lazy_deps.py` | **yes** | not agent-reachable | **UNMANAGED (host-level)** — `_install()` runs `uv pip install` / `pip install` / `ensurepip`. See below. |
| Checkpoint maintenance | `tools/checkpoint_manager.py` | yes | **no** | **DISABLED** — `checkpoints.enabled: false`, and no non-test caller exists in the tree |
| Gateway service | `gateway/run.py` | yes | **no** | **DISABLED** — the gateway is not run in the certified configuration |
| Desktop / updater helpers | `apps/desktop/electron/*` | yes | **no** | **DISABLED** — desktop app not run |
| Docker / Singularity envs | `tools/environments/{docker,singularity}.py` | yes | no | **DISABLED** — local environment only |

### The two UNMANAGED rows, examined

An earlier draft of this document classified both remaining UNMANAGED rows as
"non-consequential". A closer trace showed that was **wrong for one of them**,
and the corrected analysis is below. Only *consequential and agent-reachable*
UNMANAGED paths block full-profile certification.

**`tools/env_probe.py` — non-consequential. Confirmed.**
Its single subprocess site is `_run()`, which executes short read-only version
probes with `capture_output=True`, `stdin=subprocess.DEVNULL`, and a 3-second
timeout. There are no file writes, no network calls, and no external state
mutation anywhere in the module. It is invoked at agent startup when
`agent.environment_probe: true` (which this configuration sets). Reading the
local Python version is not a consequential act.

**`tools/lazy_deps.py` — CONSEQUENTIAL, but not agent-reachable here.**
`_install()` runs `uv pip install`, `python -m pip install`, and `ensurepip`.
That means network access, package installation, and third-party code placed
where it will later execute in-process. Describing it as non-consequential was
a mistake.

What keeps it outside the certified boundary is *reachability*, not harmlessness:

- The install path is reached only from `tools/vision_tools.py`,
  `transcription_tools.py`, `tts_tool.py`, `fal_common.py`,
  `environments/modal.py`, `environments/daytona.py`,
  `computer_use/cua_backend.py`, and the `plugins/web|video_gen|memory|platforms`
  providers. Under `toolsets: [hermes-cli]` none of those toolsets or plugins
  are loaded, and the adapter additionally denies computer use and remote
  environments.
- The one bootstrap reference, `hermes_bootstrap.py:179`, calls
  `activate_durable_lazy_target()`, which only wires an existing directory onto
  `sys.path`. It does not install.

So no model-called action in the certified profile can reach it. It is recorded
as a **host-level** consequential path — the same category as the operator
having run `pip install` before starting Hermes — and it sits outside SafeLoop's
routed-action boundary by construction.

**Certified-configuration dependency, stated plainly.** `_allow_lazy_installs()`
defaults to `True` and *fails open* when config is unreadable. The kill switch
`security.allow_lazy_installs: false` is opt-in. So the protection here is "the
code path is not loaded", not "installs are disabled". Enabling any media, web,
platform, or remote-environment toolset would make a consequential
network-and-install path reachable **without SafeLoop being aware of it**.

Recommended hardening for a certified deployment:

```yaml
security:
  allow_lazy_installs: false
```

This is the weakest link in the Hermes certification, and it is a property of
the *configuration*, not of SafeLoop. A reviewer who disagrees with the
reachability analysis should treat the coding profile as
`PASS_WITH_LIMITATIONS` rather than fully certified.

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

**Scope of this proof.** The Hermes reference adapter and the real Hermes
middleware were exercised live against the SafeLoop runtime. Provider-backed
autonomous model generation was **not** part of this certification: no model
credentials were used and no model chose the tool calls. The tool calls were
issued directly to the same middleware function Hermes invokes, which is what
makes the deterministic security result reproducible. What is certified is the
adapter and the runtime, not a model's behaviour.

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
