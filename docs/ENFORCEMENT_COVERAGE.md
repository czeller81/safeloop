# Enforcement Coverage

SafeLoop governs actions that are routed through SafeLoop. It does not universally intercept private tools, direct shell calls, direct file edits, direct API calls, memory writes, publishing, messaging, deployments, or network access that bypass SafeLoop.

| Surface | Request intercepted? | Policy before effect? | Approval enforced? | Evidence recorded? | Fail-closed supported? | Integration responsibility |
| --- | --- | --- | --- | --- | --- | --- |
| CommandGuard | Yes for `createCommandGuard().run()` | Yes | Holds approval-required commands before shell execution | Command decisions and diagnostics | Yes through policy result and command denial | Route shell commands through CommandGuard |
| MCP gateway | Yes for SafeLoop MCP tools | Yes | Yes for gateway decisions | MCP command/activity events | Yes for routed commands | Configure MCP hosts to use SafeLoop tools instead of raw shell tools |
| MCP stdio | Yes for JSON-RPC calls to SafeLoop tools | Yes | Yes for gateway decisions | Stdio tool results can record events | Yes for routed calls | Preserve stdout protocol behavior and route consequential tools through SafeLoop |
| HTTP governance | Yes for `/api/governance/evaluate` and `/api/governance/memory` | Yes | Returns binding decision; caller must enforce custom effects | Optional record flag and memory events | Yes through `createGovernedPolicyEngine().evaluateAsync()` | In secure mode, configure bearer token, tenant allowlist, and rate-limit hook |
| CLI/stdin JSON | Yes for SafeLoop CLI commands | Yes | Returns decisions; wrappers must enforce | Optional recording | Yes when wrappers use fail-closed evaluation | Agents must execute through the CLI wrapper |
| TypeScript SDK | Yes when caller invokes SDK before effect | Yes | Approval APIs available | Ledger APIs available | Yes via `createGovernedPolicyEngine()` | SDK caller must honor `allowed`, `requiresApproval`, `shouldPause`, and `shouldStopAgent` |
| Python client | Yes for requests submitted by the client | Yes through canonical SafeLoop engine | Returns canonical decision; Python does not implement policy | Delegates to HTTP/CLI | HTTP timeout/auth supported by client; engine timeout on server | Python agent must call SafeLoop before side effects |
| Custom adapters | Only if adapter calls SafeLoop first | Yes when adapter is implemented correctly | Adapter must block or hold effects | Adapter should record evidence/outcome | Use `createGovernedPolicyEngine()` for policy failures | Adapter author owns side-effect ordering |
| Memory adapters | Yes for reference `createGovernedMemoryAdapter()` | Yes before persistence | Review-required memory is not persisted by reference adapter | Memory decisions recorded | Yes for verification path | External memory stores must call SafeLoop before durable writes |

## Certification Rule

A capability should be marked `VERIFIED_WORKING` only when the SafeLoop boundary is implemented and independently testable for that surface. Anything requiring an external tool to opt in should remain `PARTIAL` until a reference adapter proves the pre-effect ordering.
