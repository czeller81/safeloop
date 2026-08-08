# SafeLoop v0.2 Certification Matrix

**Date:** 2026-08-07
**Branch:** `runtime-governance-v0.2` (RC1 truth audit applied)
**Protocol:** `safeloop.runtime.v1`
**Runtime:** 0.2.0
**Verdict:** `READY_FOR_V0_2_CONTROLLED_RELEASE`

Statuses: `VERIFIED_WORKING`, `PARTIAL`, `MISSING`, `OUT_OF_SCOPE`.

| # | Item | Status | Evidence / certification impact |
| --- | --- | --- | --- |
| 1 | Runtime protocol | VERIFIED_WORKING | `safeloop.runtime.v1`, 26 JSON Schemas, version asserted on every schema |
| 2 | Schema validation | VERIFIED_WORKING | Zero-dependency subset validator; a test fails if any schema uses an unimplemented keyword |
| 3 | Canonical action | VERIFIED_WORKING | Deterministic; sorted keys, ordered arrays, single empty form, selective case folding |
| 4 | Action fingerprint | VERIFIED_WORKING | SHA-256; 19 pairwise divergence cases; key-order and cwd-spelling invariance |
| 5 | Bound approval | VERIFIED_WORKING | HMAC-signed, bound to fingerprint + full identity tuple |
| 6 | Replay protection | VERIFIED_WORKING | `consumed`; 16-way and 24-process races yield one winner |
| 7 | Forgery protection | VERIFIED_WORKING | `forged` for bad signature, foreign secret, and post-signing edits |
| 8 | Argument substitution protection | VERIFIED_WORKING | Fingerprint recomputed from submitted bytes → `fingerprint_mismatch` |
| 9 | Context substitution protection | VERIFIED_WORKING | Distinct tenant/agent/task/session/scenario mismatch codes |
| 10 | Atomic redemption | VERIFIED_WORKING | `openSync(path,'wx')`; proven across 24 OS processes |
| 11 | Runtime daemon | VERIFIED_WORKING | Loopback HTTP + unix socket; graceful shutdown; deterministic startup |
| 12 | Local authentication | VERIFIED_WORKING | Two credential layers; 0600 connection file; identical response for absent/wrong |
| 13 | Managed executor | VERIFIED_WORKING | Six-step admission before dispatch; typed rejections |
| 14 | Shell | VERIFIED_WORKING | Structured argv preferred; shell interpretation declared not inferred; trust vars stripped |
| 15 | Filesystem | VERIFIED_WORKING | Workspace-aware; realpath containment; hashes not file bodies |
| 16 | Git | VERIFIED_WORKING | 24 structured operations; fixed argv templates defeat flag smuggling |
| 17 | HTTP / network | VERIFIED_WORKING | Structured classification; raw credentials in headers refused |
| 18 | MCP gateway | VERIFIED_WORKING | Downstream calls permit-bound; refuses and reports `mcp_managed:false` with no transport |
| 19 | Memory governance | VERIFIED_WORKING | 527785c poisoning checks reused verbatim; six dispositions preserved |
| 20 | Memory candidate binding | VERIFIED_WORKING | Candidate fingerprint + persistence permit; 7 substitution vectors rejected |
| 21 | Memory provenance | VERIFIED_WORKING | Answers "why does this agent remember this?"; protocol-validated |
| 22 | Identity | VERIFIED_WORKING | Runtime-owned after session start; caller substitution ignored |
| 23 | Tenant isolation | VERIFIED_WORKING | Permits, approvals, memory permits, and retrieval all tenant-scoped |
| 24 | Delegation | VERIFIED_WORKING | Exact inheritance; widening raises `privilege_widening`; budgets capped at parent remaining |
| 25 | Circuit breaker | VERIFIED_WORKING | Admission control at the executor; pre-issued permit still blocked |
| 26 | Budgets | VERIFIED_WORKING | Admission control; exhaustion blocks a real execution |
| 27 | Evidence | VERIFIED_WORKING | Execution results become evidence with agent/task/tenant attribution |
| 28 | Artifact provenance | VERIFIED_WORKING | Pre/post content hashes; tampering detectable |
| 29 | Ledger | VERIFIED_WORKING | Seal + verify; tampering detected (C32) |
| 30 | Control Tower / status | VERIFIED_WORKING | Real sessions, breaker, budgets, approvals, ledger, managed paths. No fabricated telemetry. |
| 31 | Profiles | VERIFIED_WORKING | Four data-driven profiles; total severity order; validated on load |
| 32 | TypeScript SDK | VERIFIED_WORKING | Session-oriented; held actions surfaced not thrown |
| 33 | Python SDK | VERIFIED_WORKING | 20 tests, 13 against a live daemon |
| 34 | MCP adapter | VERIFIED_WORKING | `mcp:doctor:hermes` 8/8; existing flows unchanged |
| 35 | `safeloop run` | VERIFIED_WORKING | Full lifecycle; declares managed paths; seals ledger |
| 36 | Conformance suite | VERIFIED_WORKING | 34 checks; applicability-aware; four profiles certified |
| 37 | Hermes reference adapter | VERIFIED_WORKING | Migrated to bound approvals; managed families execute in SafeLoop |
| 38 | Hermes live adapter/middleware bound approval | VERIFIED_WORKING | 17/17 against real runtime + disposable repo. Provider-backed model generation not included — see below. |
| 39 | Hermes native memory | **OUT_OF_SCOPE** | Lifecycle proven through the adapter; Hermes' *native* store deliberately unused — see below |
| 40 | Hermes path inventory | VERIFIED_WORKING | Re-audited at RC1: `checkpoint_manager` → DISABLED; `lazy_deps` → DISABLED via profile seal, verified against Hermes' gate |
| 41 | Bypass audit | VERIFIED_WORKING | No enabled consequential bypass found within the certified boundary |
| 42 | Failure testing | VERIFIED_WORKING | Exception, timeout, corrupt state, corrupt ledger, outage — all fail closed |
| 43 | Multi-tenant testing | VERIFIED_WORKING | Cross-tenant permit/approval/memory all rejected |
| 44 | Security claims | VERIFIED_WORKING | Repository-wide audit found only disclaimers, no overclaims |
| 45 | Dependency audit | VERIFIED_WORKING | 0 vulnerabilities; **no new runtime dependencies added** |
| 46 | External memory store compatibility | VERIFIED_WORKING | `/v1/memory/authorize` + SDK methods; reference store injectable and optional |
| 47 | Model-in-the-loop Hermes certification | **OUT_OF_SCOPE** | No provider credentials used; explicitly not claimed |
| 48 | Lazy dependency installation disabled | VERIFIED_WORKING | Profile `launch_environment` + adapter seal verified against `lazy_deps._allow_lazy_installs()`; real `ensure()` refused |

## Explicit release claims

| Claim | Answer |
| --- | --- |
| Hermes provider-backed model-in-the-loop certification | **NO** |
| Hermes native memory certification | **NO** |
| SafeLoop external-memory-adapter compatibility | **YES** |
| Hermes adapter/middleware live certification | **YES** |
| Enabled consequential agent-reachable unmanaged path in the certified coding profile | **NONE KNOWN** |

## OUT_OF_SCOPE items

### 47 — Model-in-the-loop

The Hermes reference adapter and the real Hermes middleware were exercised live
against the SafeLoop runtime. **Provider-backed autonomous model generation was
not part of this certification.** No model credentials were used and no model
selected the tool calls; they were issued directly to the same middleware
function Hermes invokes. What is certified is the adapter and the runtime, not a
model's behaviour. This does not weaken the deterministic security result — it
is what makes it reproducible.

### 39 — Hermes native memory

**What is proven.** The complete memory lifecycle through the real adapter
middleware: candidate → governance → bound persistence permit → activation →
retrieval in a later session, plus quarantine of a poisoned candidate that never
becomes retrievable.

**What is not claimed.** That Hermes' own memory subsystem is certified. It is
not used: SafeLoop performs persistence itself and never calls `next_call` for
the memory tool.

**Why.** Routing a candidate through governance and then handing it to an
ungoverned native store would reopen exactly the TOCTOU gap v0.2 closes.

**Original pilot limitation, resolved.** The pilot reported the Hermes memory
tool as "unavailable". Root cause: `/home/charleszeller/.hermes/config.yaml`
sets `toolsets: [hermes-cli]`, which omits the `memory` toolset. It is a
configuration matter, not a Hermes v0.17.0 limitation. The user's config was not
modified.

**Certification impact.** None for SafeLoop. Per §52, SafeLoop may be
release-ready when the memory gateway and binding are fully verified with the
reference store, the Hermes limitation is documented, and no false claim of
Hermes native memory certification is made. All three hold.

## Profile certification

| Profile | Applicable | Passed | N/A | Status |
| --- | --- | --- | --- | --- |
| coding | 34 | 34 | 0 | PROFILE_CONFORMANT |
| research | 34 | 34 | 0 | PROFILE_CONFORMANT |
| assistant | 33 | 33 | 1 | PASS_WITH_LIMITATIONS (shell denied by design) |
| strict-local | 33 | 33 | 1 | PASS_WITH_LIMITATIONS (shell denied by design) |

`assistant` and `strict-local` limitations are *by design*: those profiles
disable shell, so the execution-timeout check cannot apply. Not applicable is
reported as its own outcome rather than being counted as a pass.

## Certified Hermes boundary

**MANAGED:** shell/terminal, filesystem, git, memory.
**DISABLED:** MCP tools, code execution, delegation, browser, computer use, cron,
messaging, voice, gateway service, desktop/updater helpers, container envs,
checkpoint maintenance.
**UNMANAGED, non-consequential:** `env_probe.py` — read-only version probes, no
writes, no network.
**DISABLED (was UNMANAGED):** `lazy_deps.py` — runtime dependency installation
is now explicitly sealed by the certified profile and verified against Hermes'
own gate, rather than being merely unreachable.

No enabled consequential **agent-reachable** UNMANAGED path exists in the
certified boundary, so full-profile certification is available.

Runtime dependency installation is disabled by two independent mechanisms: the
profile's `launch_environment` declaration applied by `safeloop run`, and the
adapter's `seal_lazy_installs()` which verifies the seal against Hermes' own
gate at registration and refuses to register if it cannot be confirmed. The live
proof exercises the harder durable-install-target case, where the disable flag
alone would not block, and confirms a real `ensure()` call is refused.

The certified boundary therefore no longer rests on a reachability argument for
this path. Details in `docs/HERMES_REFERENCE_ADAPTER.md`.

## Security boundary

SafeLoop governs actions routed through SafeLoop-managed execution paths. It
evaluates and controls agent actions, approvals, memory, budgets, evidence, and
configured managed execution paths routed through the runtime.

It is **not** a kernel security module, EDR, antivirus, firewall, IAM system,
universal syscall interceptor, arbitrary process container, OS sandbox, or a
guarantee that AI is correct or safe. Unmanaged host processes require external
controls.
