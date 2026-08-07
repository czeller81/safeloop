# Language-Neutral Protocol and SDK Architecture

SafeLoop's canonical governance semantics live in the TypeScript runtime engine, but SafeLoop clients should not need to be TypeScript.

The protocol boundary is JSON:

- JSON Schema contracts in `schemas/`
- HTTP endpoints on the local monitor server
- CLI/stdin JSON commands
- MCP stdio tools
- TypeScript SDK exports
- thin Python client

Future Rust, Go, Java, and .NET clients should call the same JSON surfaces rather than reimplementing policy evaluation.

## Coupling Audit

| Area | Current state | Action |
| --- | --- | --- |
| Core governance engine | TypeScript | Acceptable as canonical engine. Keep semantics here. |
| Runtime contracts | Previously TypeScript interfaces only | Added JSON Schema contracts under `schemas/`. |
| Monitor dashboard | TypeScript/React | UI-only coupling. Does not define governance semantics. |
| MCP gateway | JSON-RPC over stdio | Already language-neutral for MCP hosts. |
| HTTP monitor API | JSON over local HTTP | Added governance endpoints. `/api/dashboard` unchanged. |
| CLI | Node/TypeScript binary | Added stdin/file JSON governance commands. |
| Python agents | No native client | Added zero-dependency thin Python client. |
| Policy engine in Python | Missing | Intentionally not added. Python must call SafeLoop. |

## Canonical Schemas

The canonical JSON contracts are:

- `schemas/governance-event.schema.json`
- `schemas/policy-request.schema.json`
- `schemas/policy-decision.schema.json`
- `schemas/approval.schema.json`
- `schemas/evidence.schema.json`
- `schemas/scenario-contract.schema.json`
- `schemas/memory-candidate.schema.json`
- `schemas/circuit-breaker-event.schema.json`

Helper schemas:

- `schemas/risk-dimension.schema.json`
- `schemas/token-usage.schema.json`
- `schemas/provenance.schema.json`

## HTTP

Start the local monitor:

```bash
npm run monitor
```

Evaluate a policy request:

```bash
curl -X POST http://127.0.0.1:3777/api/governance/evaluate \
  -H "content-type: application/json" \
  -d '{"agentId":"hermes","action":"publish release","tool":"deploy","target":"production"}'
```

Verify a memory candidate:

```bash
curl -X POST http://127.0.0.1:3777/api/governance/memory \
  -H "content-type: application/json" \
  -d '{"memory_id":"mem-001","memory_type":"lesson","situation":"Task completed","lesson":"Use local evidence","confidence":0.9,"evidence":["artifact-001"]}'
```

## CLI / Stdio JSON

Evaluate from stdin:

```bash
echo '{"agentId":"hermes","action":"publish release","tool":"deploy","target":"production"}' \
  | safeloop governance evaluate --stdin
```

Evaluate from a file:

```bash
safeloop governance evaluate --input policy-request.json
```

Record the decision event:

```bash
safeloop governance evaluate --input policy-request.json --record
```

Verify memory:

```bash
safeloop governance memory --input memory-candidate.json
```

Exit codes:

- `0`: allowed or warning
- `10`: denied, rejected, or stop-agent
- `20`: approval, pause, quarantine, or review required

## Python

The Python client is in `python/safeloop_client`.

It supports:

- Hermes
- LangGraph
- local LLM agents
- Python autonomous-agent frameworks

It does not duplicate policy logic.

```python
from safeloop_client import SafeLoopClient

client = SafeLoopClient(base_url="http://127.0.0.1:3777")

decision = client.evaluate_policy({
    "agentId": "langgraph-agent",
    "action": "send external message",
    "tool": "email",
    "target": "external-recipient",
})

if not decision["allowed"]:
    # Do not execute the downstream tool.
    pass
```

## MCP

MCP remains the best interface for hosts that support stdio MCP tools. SafeLoop keeps stdout reserved for JSON-RPC protocol messages. Custom MCP tools that do non-shell effects should call the runtime governance HTTP or SDK surface before executing.

## Future SDK Rule

New SDKs should be transport wrappers plus schema helpers:

```text
Rust / Go / Java / .NET client
  -> JSON request
  -> SafeLoop HTTP, MCP, or CLI/stdin
  -> JSON decision
  -> host decides whether to execute
```

Do not fork or duplicate the policy engine unless SafeLoop formally moves the canonical engine into a shared embedded runtime.

## Boundary

SafeLoop governs only actions routed through SafeLoop. Language-neutral clients make integration easier, but they do not create universal interception. Agents and tools that bypass SafeLoop bypass SafeLoop governance.
