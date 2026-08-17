# SafeLoop Install And Verification

SafeLoop currently publishes two intentionally separate GitHub entry points.
Use the approved baseline for stable evaluation, and use the Phase 6 branch only
for review of unapproved lifecycle-governance work.

## Approved Stable Baseline

The approved baseline is:

- branch: `stable`
- tag: `phase5-approved`
- commit: `0120e92a87b0245faf079391bcddcbf3d6627c81`

```bash
git clone https://github.com/czeller81/safeloop.git
cd safeloop
git checkout stable
npm ci
npm test -- --runInBand
python3 -m pytest python/tests
npx tsc --noEmit
npm run build
npm run build:ui
npm audit --audit-level=moderate
```

Equivalent pinned checkout:

```bash
git checkout phase5-approved
```

The stable baseline was verified on Linux/WSL with Node.js `v22.22.3`, npm
`10.9.8`, and Python `3.14.4`. Other platforms may work, but this publication
pass does not certify native Windows or macOS behavior.

## Phase 6 Review Candidate

The Phase 6 review candidate is:

- branch: `review/phase6`
- commit: `e4f8953aad51b2946c4903b06062a562e398973c`
- status: `PHASE_6_NOT_APPROVED`

```bash
git clone https://github.com/czeller81/safeloop.git safeloop-phase6-review
cd safeloop-phase6-review
git checkout review/phase6
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run build
npm run build:ui
npm audit --audit-level=moderate
```

Known Phase 6 review blockers are tracked in GitHub issues. They include MCP
descriptor-target classification follow-ups such as namespace-prefix
descriptor-target bypasses, destructive non-target descriptor nouns,
`purgeSchedule` / `wipeProgress` semantic regression coverage, and any
misplaced test assertion that remains after review.

Do not use `review/phase6` as a stable release until those findings are closed
and a new approval explicitly supersedes `PHASE_6_NOT_APPROVED`.

## Publication Boundaries

SafeLoop governs routed, managed execution paths. It does not prove arbitrary OS
activity outside SafeLoop, every downstream shell side effect, remote HTTP
business outcomes, or downstream effects performed by external MCP servers.
