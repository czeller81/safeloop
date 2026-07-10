# SafeLoop Local Monitor

SafeLoop includes a local-first monitor dashboard for explicit SafeLoop events. It reads files from the local `.safeloop` directory and serves a dashboard on `127.0.0.1`.

## What It Shows

The current dashboard is trace-first. The first screen is designed to answer:

- what the agent did,
- what SafeLoop decided,
- whether human review was needed,
- and what evidence was created.

Main areas:

- **Trace Console**: compact event table with event type filters, decision/status/risk/approval/evidence/cost columns, latest-row highlighting, and selectable trace rows.
- **Decision Inspector**: right-side details drawer for the selected trace, including summary, decision, human review, evidence, cost/tokens, and redacted raw event JSON.
- **Governance strip**: compact Observe -> Decide -> Approve -> Prove flow.
- **Operational Details**: collapsed advanced diagnostics for loops, cost, approvals, evidence, handoffs, readiness, oversight, and timecards.

## Local Data Sources

The monitor reads local files such as:

```text
.safeloop/events.jsonl
.safeloop/model-pricing.json
.safeloop/steering.jsonl
```

It does not collect telemetry, conversation text, chain-of-thought, or remote signals.

## Commands

Start the monitor for the current working directory:

```bash
npm run monitor
```

Start on a custom port:

```bash
npm run monitor -- --port 3778
```

Generate dogfood monitor data and open that ledger:

```bash
npm run dogfood:handoff
npm run monitor:dogfood
```

If installed from the package CLI:

```bash
npx safeloop monitor
npx safeloop monitor --port 3778
```

## URL

```text
http://127.0.0.1:3777
```

The server binds to `127.0.0.1` for local-first use.

## Local APIs

```text
GET /api/dashboard
GET /api/timecards/export
GET /health
```

`/api/dashboard` preserves the existing top-level dashboard keys:

- `activeLoops`
- `events`
- `eventCount`
- `monitoredPath`
- `lastUpdated`
- `costSummary`
- `modelUsage`
- `risks`
- `approvals`
- `artifacts`
- `handoffs`
- `readiness`
- `steeringInsights`
- `viewModel`
- `oversight`

Additional optional diagnostics may appear under the monitor view model.

## Malformed JSONL Tolerance

The monitor reads `events.jsonl` line by line. If one line is malformed JSON, SafeLoop skips that line and preserves valid events before and after it.

Skipped-line diagnostics are exposed in monitor diagnostics:

```text
viewModel.diagnostics.eventRead
```

This prevents one bad local ledger line from taking down the dashboard, token/cost reads, or `/api/dashboard`.

## Timecard Export

The monitor exposes billable-agent timecard candidates at:

```text
GET /api/timecards/export
```

The export is local JSON and is derived from the same SafeLoop events and model usage records as the dashboard.

## Security Notes

- Local machine only by default.
- No cloud services required.
- No external data transfer by the monitor.
- No authentication is built in for the local server.
- Do not expose the monitor port to an untrusted network.
- Raw event metadata may contain user-provided values; the dashboard redacts obvious secret-like keys in the inspector, but sensitive values should not be written to the ledger in the first place.
