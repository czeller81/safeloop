# Contributing

Thanks for helping improve SafeLoop.

## Install

```bash
npm ci
```

## Run tests

```bash
npm test
```

## Build

```bash
npm run build
```

## TypeScript check

```bash
node ./node_modules/typescript/bin/tsc --noEmit
```

## Live simulation

```bash
npm run example:live-simulation
```

## Useful local checks

```bash
npm run demo:codex-governed
npx safeloop init
npx safeloop check --command "rm -rf ."
npx safeloop ledger seal
npx safeloop ledger verify
npm run certify -- --profile coding
npm run mcp:doctor:hermes
```

## Security-sensitive changes

Approval, permit, executor, policy, risk, memory, ledger, and credential changes need focused regression tests and documentation updates. Do not weaken fail-closed behavior, fingerprint binding, one-time permit consumption, or the cooperative enforcement boundary to make a test pass.

Do not open public issues with exploit details or secrets. Use the private security reporting path in `SECURITY.md`.

## Contribution principles

- Keep the package dependency-free where practical.
- Prefer small, boring APIs over broad abstractions.
- Add or update tests for behavior changes.
- Document any new public API in the README.
- Do not add hidden network, publish, or push behavior.
- Keep local validation passing before asking for review.
- Be explicit about the cooperative enforcement boundary. SafeLoop is not an OS sandbox by itself.
- Do not change MCP stdio behavior or event ledger schema without calling that out clearly.

## Scope

This project is intentionally focused on local-first AI agent governance:
policy gates, command guard, scenario loops, MCP gateway tools, specialist
governance, effect guard coverage, local event ledgers, dashboard visibility,
and evidence/cost accountability.
