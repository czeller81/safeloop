# GitHub Issue Reconciliation - 2026-08

Repository: `czeller81/safeloop`
Audit date: 2026-08-14
Live open issues before reconciliation: 4
GitHub Pages: NOT_PRESENT

Source of truth: live `gh issue list --state all --limit 100` and REST `gh api repos/czeller81/safeloop/issues/<n>` responses. `gh issue view --comments` was not usable because GitHub's GraphQL issue query requested the deprecated classic Projects `projectCards` field; REST issue responses showed zero comments for issues #4-#7.

## Issue #4

TITLE: Hermes MCP production-readiness diagnostics

PRE-AUDIT STATUS: OPEN

BODY SUMMARY: Improve Hermes + SafeLoop diagnostics beyond basic MCP visibility. Check SafeLoop tool availability, unmanaged raw command exposure, MCPorter setup boundary, and recommended stdio config from a built package. Do not change MCP stdio behavior.

IMPLEMENTATION EVIDENCE:

- `package.json` exposes `npm run mcp:doctor:hermes`.
- `src/mcpDiagnostics.ts` implements `runMcpDoctor({ host: 'hermes' })`, built/source config generation, stdio initialization, tool listing, `safeloop.status`, and denial of `rm -rf .` through `safeloop.checkCommand`.
- `src/cli.ts` exposes `safeloop mcp doctor --host hermes`, `safeloop mcp print-config hermes`, and MCPorter helper output.

DOC EVIDENCE:

- `docs/MCP.md`, `docs/HERMES_INTEGRATION_ARCHITECTURE.md`, `docs/HERMES_REFERENCE_ADAPTER.md`, and `README.md` document the MCP/Hermes boundary without claiming native interception.

TEST EVIDENCE:

- `npm run mcp:doctor:hermes` on 2026-08-14 passed node, npm, built CLI, MCP initialize, tools/list, `safeloop.status`, dangerous command denial, and Hermes config checks.
- `tests/mcpDiagnostics.test.ts` and `tests/mcpCliIntegration.test.ts` cover MCP diagnostics/CLI behavior.

FINAL CLASSIFICATION: FULLY_RESOLVED

ACTION: CLOSE_RESOLVED

## Issue #5

TITLE: Offline deployment security checklist command

PRE-AUDIT STATUS: OPEN

BODY SUMMARY: Explore a local command checking appliance readiness: policy present, ledger path writable, ledger seal status, monitor availability, MCP doctor status, risky defaults, storage notes, and reminder that OS/network/storage controls are required outside SafeLoop.

IMPLEMENTATION EVIDENCE:

- `src/applianceDoctor.ts` implements `runApplianceDoctor` with local SafeLoop directory, policy readiness, ledger seal verification, event ledger readability, deployment manifest, K-12 offline controls, MCP readiness, and deployment boundary notes.
- `src/cli.ts` exposes `safeloop appliance doctor [--profile <profile>] [--host <host>] [--baseDir <path>]`.

DOC EVIDENCE:

- `docs/PRODUCTION_READINESS.md`, `docs/SCHOOL_DISTRICT_DEPLOYMENT.md`, `docs/K12_COMPLIANCE_MATRIX.md`, `docs/SECURITY_MODEL.md`, and `SECURITY.md` document deployment boundaries and external OS/network/storage responsibilities.

TEST EVIDENCE:

- Temporary K-12 base command on 2026-08-14: `npx ts-node src/cli.ts appliance doctor --profile k12-offline-rag --host hermes --baseDir <tmp>` passed local directory, policy readiness, event ledger read, K-12 offline controls, and MCP readiness; it warned for expected unsealed empty ledger and missing optional deployment manifest.
- `tests/applianceDoctor.test.ts` covers doctor checks.

FINAL CLASSIFICATION: FULLY_RESOLVED

ACTION: CLOSE_RESOLVED

## Issue #6

TITLE: Exportable audit bundle for district review

PRE-AUDIT STATUS: OPEN

BODY SUMMARY: Design a local export bundle for evidence, approvals, decisions, ledger seal status, policy snapshot, and deployment metadata without cloud services or ledger schema changes.

IMPLEMENTATION EVIDENCE:

- `src/auditExport.ts` implements `createAuditExportBundle` and `writeAuditExportBundle` with events, risks, approvals, artifacts, policy, ledger seal, readiness, deployment metadata, and MCP doctor data.
- `src/cli.ts` exposes `safeloop audit export [--out <path>] [--host <host>] [--baseDir <path>]`.
- The implementation reads existing local state and does not change the event ledger schema.

DOC EVIDENCE:

- `docs/SCHOOL_DISTRICT_DEPLOYMENT.md`, `docs/K12_COMPLIANCE_MATRIX.md`, and `README.md` describe local audit/review workflows and evidence boundaries.

TEST EVIDENCE:

- Temporary K-12 base command on 2026-08-14 wrote an audit bundle with summary, policy, and readiness data using `npx ts-node src/cli.ts audit export --baseDir <tmp> --out <tmp>/audit-bundle.json`.
- `tests/auditExport.test.ts` covers the audit export bundle.

FINAL CLASSIFICATION: FULLY_RESOLVED

ACTION: CLOSE_RESOLVED

## Issue #7

TITLE: K-12 local RAG appliance hardening profile

PRE-AUDIT STATUS: OPEN

BODY SUMMARY: Define a local-first school district offline/local RAG appliance profile with safer starter policy, network/export/delete/removable-media approval defaults, NAS/SAN storage guidance, ledger sealing workflow, and readiness checks. No cloud dependencies; preserve cooperative boundary.

IMPLEMENTATION EVIDENCE:

- `src/policyConfig.ts` defines `K12_OFFLINE_RAG_POLICY` and markdown policy text for `k12-offline-rag`.
- `src/cli.ts` supports `safeloop init --profile k12-offline-rag` and `safeloop appliance doctor --profile k12-offline-rag`.
- `src/applianceDoctor.ts` checks common K-12 offline approval patterns for network, export, sync, and update commands.

DOC EVIDENCE:

- `docs/SCHOOL_DISTRICT_DEPLOYMENT.md` documents district local deployment, storage, ledger sealing, and external control responsibilities.
- `docs/K12_COMPLIANCE_MATRIX.md` maps SafeLoop controls to K-12 deployment concerns.
- `SECURITY.md` states SafeLoop is not by itself FERPA/COPPA/CIPA/NIST compliance and must be paired with district controls.

TEST EVIDENCE:

- `tests/k12LocalRagDemo.test.ts`, `tests/policyConfig.test.ts`, and `tests/applianceDoctor.test.ts` cover the K-12 policy/demo/readiness behavior.
- Temporary K-12 appliance doctor run on 2026-08-14 passed policy readiness and K-12 offline controls.

FINAL CLASSIFICATION: FULLY_RESOLVED

ACTION: CLOSE_RESOLVED

## Additional Live Issues

None observed in the live issue list beyond #4-#7.

## Closing Policy

No issues should be deleted. Each resolved issue should receive a concise closing comment with implementation, documentation, test, and command evidence, then be closed as implemented.
