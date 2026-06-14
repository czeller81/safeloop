# Safeloop Live Loop Monitor

Safeloop v0.7 adds a local-first monitor for explicit agent events.

## What it shows

- Active loops
- Event timeline
- Cost dashboard
- Steering dashboard
- Risk dashboard
- Approval queue
- Artifact timeline
- Handoff queue
- Release readiness

## How it works

Safeloop reads explicit local records from:

- `.safeloop/events.jsonl`
- `.safeloop/model-pricing.json`
- `.safeloop/steering.jsonl`

It does not collect telemetry, conversation text, chain-of-thought, or remote signals.

## Commands

```bash
npm run monitor
npm run monitor -- --port 3778
npx safeloop monitor
npx safeloop monitor --port 3778
```

## URL

```text
http://127.0.0.1:3777
```

## Dashboard data API

The monitor serves a local JSON snapshot at:

```text
GET /api/dashboard
```

This snapshot includes:

- activeLoops
- events
- costSummary
- modelUsage
- risks
- approvals
- artifacts
- handoffs
- readiness
- steeringInsights

## Notes

- Local machine only
- No authentication required
- No cloud services
- No external data transfer
