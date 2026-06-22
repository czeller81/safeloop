# Safeloop

## Agent Accountability + Live Loop Monitor SDK

Current release: v0.8.0

### Current architecture

- Case Files
- Attachments
- Participants
- Agent Identity
- Handoff Manifest
- Report Query Layer
- Agent Adapter Protocol
- Event Stream
- Live Loop Monitor
- Cost Tracking
- Model Usage Tracking
- Steering Intelligence
- Goal Drift Detection
- Release Readiness

Safeloop helps AI agents and humans collaborate through portable Case Files.

As teams move from one AI agent to many, the hardest problem is no longer execution—it is continuity. Context gets lost, decisions become unclear, approvals disappear, and work must be repeatedly explained to the next agent or reviewer.

Safeloop solves this by creating structured Case Files that travel with the work.

A Case File captures:

* Goals
* Context
* Decisions
* Risks
* Approvals
* Attachments
* Handoffs
* Reports

This creates a portable accountability trail that allows agents and humans to continue work without losing critical information.

Built for:

* Hermes
* OpenCode
* Claude Code
* Codex
* Replit Agents
* Custom agent workflows
* Scripts
* Human-operated workflows

### What Safeloop Provides

#### Agent Accountability

Track:

* what happened
* why it happened
* who made the decision
* what evidence was used
* what risks were accepted

#### Agent Handoffs

Transfer work between:

* agent → agent
* agent → human
* human → agent

without requiring the entire task to be re-explained.

Hydration helper
----------------

Safeloop provides a hydration helper for receiving agents: generate a Handoff Manifest on the sending side (generateHandoffManifest) and pass the manifest to the receiving process. The receiving agent should call hydrateCaseFileFromManifest(manifest, options) to rebuild a working Case File (participants, required attachments, and an optional received handoff record). This keeps the accountability trail intact across Hermes, OpenCode, and other sub-agents without sharing unsafe historic state by default.

#### Governance Primitives

Safeloop also includes:

* Policy Gates
* Circuit Breakers
* Action Ledgers
* Markdown Reports

These primitives help teams build safer agentic workflows while maintaining a complete accountability trail.

### Why Safeloop Exists

Git tracks code.

Safeloop tracks agent work.

Git answers:

"What changed?"

Safeloop answers:

"Why did it change?"
"Who decided?"
"What evidence was used?"
"What should happen next?"

### Local First

Safeloop is intentionally:

* local-first
* file-based
* lightweight
* TypeScript-native

No cloud service.
No database required.
No hosted platform.

Your Case Files remain under your control.

Safeloop does not:

- run agents
- execute shell commands
- collect telemetry
- capture conversations
- send network data
- replace human approval

## Oversight Intelligence (v0.8.0)

Version 0.8.0 adds an Oversight Intelligence layer that analyzes complete agent loops (Case File → Task → Events → Model Usage → Outcomes) and derives proactive warnings, anomalies, explainability coverage, and an oversight score per loop. Safeloop remains runtime-agnostic: agents emit events, Safeloop derives oversight intelligence.

Key features:

- Loop timecards that aggregate events, tokens, cost, risks, approvals, artifacts, handoffs, explainability, and feedback.
- An analyzer that identifies stale or wasteful loops, unresolved approvals, missing attribution, high-risk work without mitigation, repeated failures, and budget anomalies.
- Explainability schema support (decision.explained or decision.made with rationale metadata).
- Feedback events (feedback.recorded) and per-loop feedback summaries.
- Deterministic oversight score (0–100) with levels: healthy | watch | needs_review | critical and recommended actions.

This release warns, scores, and reports — it does not block execution. See docs and /api/dashboard for the oversight payload shape.

## Live Agent Activity + Handoff Flow

v0.8.0 includes a first Live Agent Activity slice for the monitor. This small, testable feature makes the local monitor feel active and operational:

* active agents (recently active)
* recent activity stream (event-level feed)
* handoff-to-handoff flow (chronological handoffs)
* warnings and blockers
* approvals, risks, artifacts, feedback
* token-cost pulse (recent token usage and cost trend)

Limitations:

* v0.8.0 visualizes and surfaces signals; hard-stop enforcement is not enabled yet. That will come in a future release after operators validate the live flows.

## Configurable oversight thresholds

Safeloop Oversight Intelligence uses a set of default thresholds to decide when to surface warnings and anomalies. For v0.8.0 these defaults live in `src/oversightConfig.ts` and are applied by the centralized analyzer in `src/oversightAnalyzer.ts`.

Key points:

- Defaults are defined in `src/oversightConfig.ts` (example fields: `staleLoopMs`, `maxLoopCost`, `maxLoopTokens`, `maxLoopDurationMs`, `penalties`, etc.).
- Analyzer calls can override thresholds by passing an `options` object to the analyzer call. This is useful for tests or one-off recalculations with different sensitivity.
- The live monitor exposes the active configuration in the dashboard API under `oversight.config` so UI clients and operators can inspect which thresholds were used to compute the oversight score.
- Safeloop remains runtime/model/agent agnostic — the analyzer consumes event streams and does not assume any specific underlying model provider or agent runtime.

Example: overriding thresholds when calling the analyzer (Node/TypeScript)

```typescript
import { analyzeLoopOversight } from './src/oversightAnalyzer';

// loop and collection are the analyzer inputs (a single loop object and the full collection)
const overrideOptions = {
  staleLoopMs: 1000 * 60, // 1 minute — useful for fast tests
  maxLoopCost: 0.0001,    // extremely low cost threshold for forcing cost warnings
  maxLoopTokens: 10,      // tiny token budget to force token warnings
};

const result = analyzeLoopOversight(loop, collection, overrideOptions);

console.log('Oversight score:', result.oversightScore);
console.log('Active config used by analyzer:', result.config);
```

Notes:

- For v0.8.0 we do NOT load project-level runtime config files (e.g., `.safeloop/oversight-config.json`). That is a future enhancement. The current approach keeps defaults in code and supports per-call overrides via the analyzer API.
- Because the analyzer returns the active config with its output (`result.config`), the monitor view model includes `oversight.config` in `/api/dashboard` so UI clients can show thresholds alongside scores and warnings.

## Why this exists

Local AI agent loops fail in predictable ways:
- repeated retries on the same error
- uncontrolled scope expansion
- token burn on unproductive attempts
- unsafe actions that should be reviewed before execution

This package gives you small governance primitives instead of a full agent stack. It is designed to stay boring, auditable, and easy to reason about.

## How Safeloop is different

Safeloop is not an enterprise AI governance platform or full agent runtime.

It is a lightweight TypeScript SDK for local agentic coding workflows. It gives developers simple primitives they can embed around tools like OpenCode, Claude Code, Codex, Hermes-style operators, or custom scripts.

Use Safeloop when you want a small, understandable control layer:

- policy gates before execution
- circuit breakers during execution
