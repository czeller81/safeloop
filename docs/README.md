# SafeLoop Documentation Index

SafeLoop documentation is split between current user guidance, developer references, and preserved release/audit evidence. Historical files are retained deliberately so the security history stays inspectable.

## Start Here

| Document | Classification | Purpose |
| --- | --- | --- |
| [RUNTIME_ARCHITECTURE.md](RUNTIME_ARCHITECTURE.md) | CURRENT | Canonical v0.2 runtime-governance architecture. |
| [MANAGED_EXECUTION.md](MANAGED_EXECUTION.md) | CURRENT | Managed executor boundary and MANAGED / UNMANAGED / DISABLED model. |
| [APPROVAL_MODEL.md](APPROVAL_MODEL.md) | CURRENT | Bound approval and one-time permit model. |
| [MEMORY_GOVERNANCE.md](MEMORY_GOVERNANCE.md) | CURRENT | Governed memory persistence model. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | CURRENT | Current threats, mitigations, and residual risks. |
| [SECURITY_MODEL.md](SECURITY_MODEL.md) | CURRENT | Public security boundary and deployment responsibilities. |
| [CONFORMANCE.md](CONFORMANCE.md) | CURRENT | Runtime profile conformance model. |
| [PROFILES.md](PROFILES.md) | CURRENT | Certified profile behavior and execution path inventory. |

## Architecture

| Document | Classification | Purpose |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | CURRENT | Short public architecture overview. |
| [RUNTIME_GOVERNANCE_ARCHITECTURE.md](RUNTIME_GOVERNANCE_ARCHITECTURE.md) | CURRENT | Detailed v0.2 architecture map and implementation status. |
| [architecture/safeloop-runtime-governance-v2.mmd](architecture/safeloop-runtime-governance-v2.mmd) | CURRENT | Editable v2 architecture diagram source. |
| [assets/runtime-governance-architecture.png](assets/runtime-governance-architecture.png) | HISTORICAL | Existing rendered architecture image retained for continuity. |
| [LANGUAGE_NEUTRAL_PROTOCOL.md](LANGUAGE_NEUTRAL_PROTOCOL.md) | DEVELOPER_REFERENCE | Protocol and SDK language-neutrality. |
| [RUNTIME_PROTOCOL.md](RUNTIME_PROTOCOL.md) | DEVELOPER_REFERENCE | Runtime API/protocol details. |
| [EVENT_MODEL.md](EVENT_MODEL.md) | DEVELOPER_REFERENCE | Runtime event and ledger event shape. |

## Runtime Controls

| Document | Classification | Purpose |
| --- | --- | --- |
| [POLICY_ENGINE.md](POLICY_ENGINE.md) | DEVELOPER_REFERENCE | Deterministic policy and risk evaluation behavior. |
| [CIRCUIT_BREAKERS.md](CIRCUIT_BREAKERS.md) | DEVELOPER_REFERENCE | Breaker states and budget enforcement. |
| [EVIDENCE_PROVENANCE.md](EVIDENCE_PROVENANCE.md) | DEVELOPER_REFERENCE | Evidence, provenance, and artifact hashing. |
| [SCENARIO_CONTRACTS.md](SCENARIO_CONTRACTS.md) | DEVELOPER_REFERENCE | Scenario contract fields and governance. |
| [FAILURE_MODES.md](FAILURE_MODES.md) | DEVELOPER_REFERENCE | Failure posture and fail-closed behavior. |
| [SECURITY_DEPENDENCIES.md](SECURITY_DEPENDENCIES.md) | DEVELOPER_REFERENCE | Dependency and platform security notes. |
| [ENFORCEMENT_COVERAGE.md](ENFORCEMENT_COVERAGE.md) | CURRENT | Which surfaces are governed and which require integration. |

## Integrations And Guides

| Document | Classification | Purpose |
| --- | --- | --- |
| [MCP.md](MCP.md) | USER_GUIDE | MCP gateway and stdio server usage. |
| [CONNECTORS.md](CONNECTORS.md) | USER_GUIDE | Connector and adapter guidance. |
| [CODEX.md](CODEX.md) | USER_GUIDE | Codex-labeled local governance demo. |
| [CLAUDE.md](CLAUDE.md) | USER_GUIDE | Claude and Claude Code usage boundary. |
| [ADAPTER_SPEC.md](ADAPTER_SPEC.md) | DEVELOPER_REFERENCE | Adapter implementation contract. |
| [AGENT_ADAPTER_PROTOCOL.md](AGENT_ADAPTER_PROTOCOL.md) | DEVELOPER_REFERENCE | Agent adapter protocol. |
| [HUMAN_APPROVALS.md](HUMAN_APPROVALS.md) | USER_GUIDE | Operator approval credential and approval flow. |
| [LIVE_MONITOR.md](LIVE_MONITOR.md) | USER_GUIDE | Runtime dashboard and monitor. |
| [SPECIALIST_GOVERNANCE.md](SPECIALIST_GOVERNANCE.md) | USER_GUIDE | Specialist routing and permission governance. |

## Deployment Patterns

| Document | Classification | Purpose |
| --- | --- | --- |
| [SCHOOL_DISTRICT_DEPLOYMENT.md](SCHOOL_DISTRICT_DEPLOYMENT.md) | USER_GUIDE | District-controlled local deployment pattern. |
| [K12_COMPLIANCE_MATRIX.md](K12_COMPLIANCE_MATRIX.md) | USER_GUIDE | K-12 compliance-oriented control mapping. |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | CURRENT | Current readiness within the routed-action boundary. |
| [CURRENT_STATE.md](CURRENT_STATE.md) | HISTORICAL | Snapshot of implementation state before the latest documentation pass. |
| [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) | HISTORICAL | Product planning reference. |
| [DOGFOOD_PLAN.md](DOGFOOD_PLAN.md) | HISTORICAL | Internal dogfooding plan. |

## Release And Audit Evidence

| Document | Classification | Purpose |
| --- | --- | --- |
| [ARCHITECTURE_COMPLIANCE_MATRIX.md](ARCHITECTURE_COMPLIANCE_MATRIX.md) | AUDIT_EVIDENCE | Runtime governance audit matrix. |
| [RUNTIME_V0_2_CERTIFICATION.md](RUNTIME_V0_2_CERTIFICATION.md) | AUDIT_EVIDENCE | v0.2 certification record. |
| [RUNTIME_V0_2_CHECKPOINT.md](RUNTIME_V0_2_CHECKPOINT.md) | AUDIT_EVIDENCE | v0.2 checkpoint record. |
| [RUNTIME_V0_2_REPORT.md](RUNTIME_V0_2_REPORT.md) | AUDIT_EVIDENCE | v0.2 runtime governance report. |
| [RUNTIME_GOVERNANCE_GAP_ANALYSIS.md](RUNTIME_GOVERNANCE_GAP_ANALYSIS.md) | AUDIT_EVIDENCE | Historical gap analysis. |
| [HERMES_REFERENCE_ADAPTER.md](HERMES_REFERENCE_ADAPTER.md) | AUDIT_EVIDENCE | Hermes reference adapter audit boundary. |
| [HERMES_INTEGRATION_ARCHITECTURE.md](HERMES_INTEGRATION_ARCHITECTURE.md) | AUDIT_EVIDENCE | Hermes integration architecture and limitations. |
| [HERMES_PILOT_REPORT.md](HERMES_PILOT_REPORT.md) | AUDIT_EVIDENCE | Hermes pilot proof and limitations. |
| [V0_7_HEAVY_TESTING_REPORT.md](V0_7_HEAVY_TESTING_REPORT.md) | HISTORICAL | Older npm `0.7.0` accountability/live-monitor SDK line testing record. |
| [evidence/](evidence/) | AUDIT_EVIDENCE | Machine-readable proof artifacts. |

## Version-History Note

GitHub `v0.2.0` is the August 2026 runtime-governance release. The public npm `safeloop@0.7.0` package is an older June 2026 accountability/live-monitor SDK line. The two version lines were not synchronized historically; future npm publication should move forward with explicit migration notes rather than rewriting either history.