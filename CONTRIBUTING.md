# Contributing

Thanks for helping improve `Safeloop`.

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

## Contribution principles

- Keep the package dependency-free where possible.
- Prefer small, boring APIs over broad abstractions.
- Add or update tests for behavior changes.
- Document any new public API in the README.
- Do not add hidden network, publish, or push behavior.
- Keep local validation passing before asking for review.

## Scope

This project is intentionally small and focused on local AI agent governance:
policy gate, circuit breaker, action ledger, markdown reports, and live
simulation.
