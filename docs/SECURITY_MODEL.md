# SafeLoop Security Model

SafeLoop is a cooperative local governance layer. It is designed to make agent actions explicit, policy-checked, reviewable, and auditable when those actions are routed through SafeLoop.

## What SafeLoop Can Enforce

SafeLoop can enforce allow/block/approval decisions for:

- commands passed to `createCommandGuard().run()`
- commands passed to `safeloop.runCommand`
- MCP stdio tool calls that use SafeLoop tools
- command steps inside `createScenarioLoop().step()`
- effects passed to `guardEffect`
- registered connector/runtime adapters that call SafeLoop before performing an effect

Blocked and approval-required guarded commands do not reach the shell.

## What SafeLoop Records

SafeLoop records local audit events such as:

- task lifecycle
- decisions and explanations
- command allow/block/approval events
- risks
- approvals
- artifacts/evidence
- handoffs
- token/cost records
- specialist delegation/review events
- effect guard evaluations

## Ledger Integrity

SafeLoop can create a sidecar seal for the current event ledger:

```bash
safeloop ledger seal
safeloop ledger verify
```

The seal uses a SHA-256 hash chain over valid event lines and is stored at `.safeloop/ledger.seal.json`. This helps detect edits after sealing. It is not a remote timestamp, notarization service, or protection against an attacker who can rewrite both the ledger and the seal.

## What SafeLoop Does Not Enforce By Itself

SafeLoop is not an OS sandbox, container, VM, endpoint security product, or cloud policy engine.

It does not universally intercept:

- private agent tools
- direct shell execution
- direct file edits or deletes
- direct network requests
- direct API calls
- direct publishing
- direct messaging
- direct deployments
- credential changes
- DNS changes
- process launches outside SafeLoop

If an agent or tool bypasses SafeLoop, it bypasses SafeLoop guardrails.

## Recommended Deployment Boundary

For meaningful containment, combine SafeLoop with:

- least-privilege credentials
- OS or container sandboxing
- network egress limits
- scoped filesystem permissions
- human approval for production-impacting actions
- MCP/connector configuration that routes sensitive actions through SafeLoop

## Honest Product Claim

SafeLoop provides deterministic local governance and accountability for actions routed through it. It does not promise universal production containment without platform-level controls.

## K-12 and Regulated Data

For school districts, SafeLoop should be deployed as part of a controlled local AI appliance pattern, not as the only compliance control. A district deployment still needs identity management, endpoint hardening, storage encryption, backups, content filtering where internet access exists, retention rules, incident response, staff training, and written data governance procedures.

SafeLoop can support that environment by:

- routing agent commands and production-impacting effects through policy checks
- requiring human approval for risky actions
- recording local evidence of agent actions and decisions
- sealing ledgers to detect post-seal edits
- keeping governance data local unless the operator exports it

SafeLoop does not classify student records, grant legal consent, filter internet content, replace access controls, or universally prevent tools from bypassing it. MCP hosts, connectors, ingestion jobs, RAG tools, and maintenance scripts should be configured so sensitive effects route through SafeLoop.
