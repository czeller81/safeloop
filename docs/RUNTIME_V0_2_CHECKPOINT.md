# SafeLoop v0.2 Runtime Governance — Campaign Checkpoint

This file exists so a fresh engineering agent can resume without the originating
conversation. It is the authoritative continuity record.

**Last updated:** 2026-08-07

## Campaign objective

Transform SafeLoop from an agent-governance toolkit into a dependable,
local-first, language-neutral **runtime governance layer for autonomous AI
agents**, and leave the development branch in a coherent controlled-release
state.

## Git state

| | |
| --- | --- |
| Workspace | `/home/charleszeller/safeloop-pilot` |
| Branch | `runtime-governance-v0.2` |
| Base at campaign start | `e0c93ec` (docs-final-certification) |
| HEAD | tip of `runtime-governance-v0.2` — the RC1 audit commit listed below |
| origin/master | `e0c93ec` — **unmodified** |
| Master merged? | **NO.** Human approval required. |
| Hermes repo | `/home/charleszeller/.hermes/hermes-agent` @ `df926a32d` (tag `safeloop-v0.2-rc1-adapter`), local-only, **not pushed**; source vendored at `docs/evidence/hermes-adapter/` |

Commits created on this branch:

```
ae66d54 feat(runtime): add v1 governance protocol and canonical action fingerprints
3cdf8b3 feat(approval): add bound single-use approval redemption and execution permits
91e3dd6 feat(executor): add managed shell, filesystem, and git execution with permits
59c1807 feat(runtime): add local safeloop daemon, authentication, and memory binding
53a079c feat(cli): add safeloop run, daemon, status, certify, profiles, and init
f369aa6 test(redteam): add adversarial suite and Hermes live bound-approval proof
123a41e fix(profiles): apply default_disposition only when no rule matches
07e269b docs: certify SafeLoop v0.2 runtime governance
fix(memory): decouple governance from storage after RC1 truth audit   <- tip
```

Resolve the tip hash with `git log -1 --oneline`; a commit cannot record its
own hash, so this file names the commit by subject instead.

## Completed components

| Stage | Component | State |
| --- | --- | --- |
| A | Baseline + gap analysis | DONE — `docs/RUNTIME_GOVERNANCE_GAP_ANALYSIS.md` |
| B | Versioned language-neutral protocol | DONE — 26 schemas in `protocol/schemas/` |
| C | Canonical action model + fingerprints | DONE — `src/runtime/canonicalAction.ts` |
| D | Bound approvals + atomic redemption | DONE — `boundApproval.ts`, `atomicStateStore.ts` |
| E | Local runtime daemon | DONE — `daemon.ts`, loopback HTTP + unix socket |
| F | Local authentication | DONE — `runtimeAuth.ts`, two credential layers |
| G | Managed execution core | DONE — `managedExecutor.ts` |
| H/I/J | Shell, filesystem, git executors | DONE — `executors/` |
| K/L/M | Memory gateway, binding, provenance | DONE — `memoryGateway.ts`, `memoryStore.ts` |
| N | Adapter contract | DONE — `docs/ADAPTER_SPEC.md` |
| O | TypeScript SDK | DONE — `client.ts` |
| P | Python SDK | DONE — `python/safeloop_client/runtime.py` |
| Q | `safeloop run` | DONE — `cliCommands.ts` |
| R | Governance profiles | DONE — `profiles/*.profile.json` |
| S | MANAGED/UNMANAGED/DISABLED model | DONE — enforced in conformance C34 |
| T | MCP governance gateway | DONE — `executors/mcp.ts` |
| U | Network/HTTP governance | DONE — `executors/http.ts` |
| V | Breakers and budgets as admission control | DONE — `budgets.ts` + executor |
| W | Identity / tenant / delegation | DONE — `runtimeCore.ts` |
| X | Control tower / status | DONE — `safeloop status` |
| Y | Conformance framework | DONE — 34 checks, `conformance.ts` |
| Z | Hermes reference adapter migration | DONE — plugin @ `72773be23` |

## Actual implemented architecture

```
Agent → adapter/SDK → runtime (canonicalize → fingerprint → decide)
      → permit → managed executor → real side effect → evidence + ledger
```

See `docs/RUNTIME_ARCHITECTURE.md` for the module map.

## Major decisions

1. **`trace_id` excluded from the fingerprint binding set.** An approval
   requested in one trace must stay redeemable by the execution that follows.
2. **Atomic claims via exclusive file create** (`openSync(path,'wx')`) rather
   than read-modify-write. Proven across 24 OS processes.
3. **Identity is runtime-owned after session start.** `propose` overwrites
   caller-supplied identity from the session record.
4. **Approvals yield permits, not booleans.** There is no representation of
   "this agent is approved" anywhere.
5. **Executors re-canonicalize and recompute the fingerprint.** A caller-supplied
   fingerprint is never trusted.
6. **Profiles are data.** Executors hold no profile knowledge.
7. **Reuse over rebuild.** The risk engine, memory checks (incl. the 527785c
   poisoning fix), evidence registry, ledger, CommandGuard, and MCP server are
   unchanged and called by the runtime.
8. **`default_disposition` applies only when no rule matches** (fixed defect).
9. **Not-applicable is a first-class conformance outcome**, distinct from pass
   and fail.
10. **Unmanageable tools are denied, not passed through.**

## Tests passing

| Suite | Result |
| --- | --- |
| Jest | 66 suites / 656 tests PASS |
| Python | 36 passed (23 runtime SDK, 13 legacy) |
| Conformance — coding | 34/34 PROFILE_CONFORMANT |
| Conformance — research | 34/34 PROFILE_CONFORMANT |
| Conformance — assistant | 33/33, 1 N/A, PASS_WITH_LIMITATIONS |
| Conformance — strict-local | 33/33, 1 N/A, PASS_WITH_LIMITATIONS |
| Hermes live proof | 19/19 |
| Dashboard control proof | 12/12 (positive + negative) |
| Build / build:ui / tsc | PASS |
| npm audit | 0 vulnerabilities |
| MCP hermes doctor | 8/8 PASS |

## Tests failing

None.

## Known limitations

1. **Hermes native memory is not used.** SafeLoop performs memory persistence
   itself; Hermes' own store is deliberately not the durable store in this
   integration. Root cause of the original pilot limitation was a config issue
   (`toolsets: [hermes-cli]` omits the `memory` toolset), not a Hermes version
   limitation. See `docs/HERMES_REFERENCE_ADAPTER.md`.
2. **`tools/lazy_deps.py` is consequential** (`pip install`) and is now
   explicitly DISABLED by the certified profile's `launch_environment`, with the
   adapter verifying the seal against Hermes' own gate and refusing to register
   otherwise. Launcher hardening is a floor, not a guarantee — a process can
   change its own environment — which is why the adapter verifies rather than
   trusts. `env_probe` is genuinely non-consequential; `checkpoint_manager` is
   DISABLED.
3. **Legacy substring risk heuristic produces false positives** — an action
   whose text contains "post" scores as EXTERNAL_COMMUNICATION. Because rules
   and risk combine most-severe-wins this is noisy, not unsafe.
4. **Linux/WSL is the only certified platform.** Windows named-pipe transport
   is designed for but not implemented.
5. **No provider-backed model-in-the-loop Hermes run.** The adapter is proven by
   driving its actual middleware; no model chose the tool calls. Explicitly not
   claimed as a model-behaviour certification.
6. **SafeLoop governs routed actions only.** Not a kernel module, EDR, firewall,
   IAM, syscall interceptor, or OS sandbox.

## Unresolved issues

None blocking. Optional follow-ups: Windows named pipe; replace the substring
risk heuristic with structural facts; model-in-the-loop Hermes run.

## RC1 audit outcome

A release-truth audit repaired: the memory store being mandatory over the
protocol (added `/v1/memory/authorize`, SDK methods, injectable store), two
Hermes path misclassifications, and one flaky TTL test.

A follow-up profile-invariant pass then made runtime dependency installation
**explicitly disabled** rather than merely unreachable: profiles gained a
generic `launch_environment` block applied by `safeloop run`, and the Hermes
adapter seals and verifies the gate at registration, refusing to register if
the seal cannot be confirmed.

Verdict held at `READY_FOR_V0_2_CONTROLLED_RELEASE`.

## Next exact implementation task

None — the campaign is complete. The next action is **human review and merge**,
which is not authorized for an agent to perform.

## Commands to resume

```bash
cd /home/charleszeller/safeloop-pilot && git status && git log --oneline -8
```

```bash
npm ci && npm run build && npx tsc --noEmit && npx jest --config jest.config.js --runInBand
```

```bash
python3 -m pytest python/tests -q && npm audit --audit-level=moderate && npm run mcp:doctor:hermes
```

```bash
npx ts-node src/cli.ts certify --profile coding
```

```bash
python3 scripts/hermes-bound-approval-proof.py
```
