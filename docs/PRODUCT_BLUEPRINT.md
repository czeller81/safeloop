# Product Blueprint

Safeloop is a lightweight governance SDK for local AI agent loops.

## Product intent

- track what happened
- preserve evidence and approvals
- support clean handoffs
- keep the control layer local-first and explicit

## Guardrail principles

- no telemetry collection
- no cloud dependency
- no hidden background collectors
- no diagnosis framing
- no certainty framing
- user agency remains intact

## Report and query direction

Safeloop reports are generated from explicit local inputs such as:

- Case Files
- ledgers
- handoff manifests
- project guardrail summaries

They are not automatic telemetry dumps.

## Query layer goals

The reports query layer should answer:

- what was checked
- what passed
- what failed
- what risks remain
- what evidence supports the result
- whether the case passes governance-audit review
- whether a handoff or release is ready
