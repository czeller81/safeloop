# SafeLoop Python Client

This is a lightweight, zero-dependency client for Python agents.

It does not duplicate the SafeLoop policy engine. It calls the canonical SafeLoop runtime governance engine through:

- local HTTP: `POST /api/governance/evaluate` and `POST /api/governance/memory`
- CLI/stdin JSON: `safeloop governance evaluate --stdin` and `safeloop governance memory --stdin`

## HTTP Usage

Start the local monitor:

```bash
npm run monitor
```

Then from Python:

```python
from safeloop_client import SafeLoopClient

client = SafeLoopClient(base_url="http://127.0.0.1:3777")

decision = client.evaluate_policy({
    "agentId": "hermes",
    "action": "publish release to production",
    "tool": "deploy",
    "target": "production",
    "context": {
        "hasHumanApproval": False,
        "scenario": {
            "scenarioId": "release",
            "requireApprovalFor": ["publish", "deploy"],
        },
    },
})

if not decision["allowed"]:
    # Do not execute the tool call.
    pass
```

## CLI Usage

```python
from safeloop_client import SafeLoopClient

client = SafeLoopClient(transport="cli", cli="npx safeloop")
```

If your runtime needs shell parsing for `npx safeloop`, wrap it with a local script and pass that script path as `cli`. For production appliance deployments, prefer a direct executable path.

## Memory Governance

```python
result = client.verify_memory({
    "memory_id": "mem-001",
    "memory_type": "lesson",
    "situation": "A local RAG answer was corrected by staff.",
    "lesson": "Prefer district-approved source PDFs for policy answers.",
    "confidence": 0.92,
    "evidence": ["artifact-review-001"],
})

if not result["allowed"]:
    # Store for review or quarantine, not durable memory.
    pass
```

## Boundary

SafeLoop governs only actions routed through SafeLoop. A Python agent that calls tools directly can bypass SafeLoop unless those tool paths integrate with this client, MCP, or another SafeLoop adapter.
