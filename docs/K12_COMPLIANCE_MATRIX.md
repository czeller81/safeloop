# K-12 Compliance and Security Matrix

SafeLoop can support district governance for local AI systems, but it does not make a deployment compliant by itself. Compliance depends on district policies, contracts, technical controls, staff procedures, and how every tool path is configured.

## Summary Matrix

| Area | What the framework expects | SafeLoop support | Required outside SafeLoop |
|------|----------------------------|------------------|---------------------------|
| FERPA | Protect education records and personally identifiable information; control disclosure; support parent or eligible student rights. | Local-first audit ledger, approval history, evidence records, and ability to require review for exports or destructive actions. | District record governance, access controls, contracts, notices, disclosure logs, amendment/access workflows, retention, and legal review. |
| COPPA | For children under 13, school consent is limited to educational context and school benefit; personal information should not be kept longer than needed. | Can record purpose, operator actions, approvals, and blocked export/network attempts when routed through SafeLoop. | Operator notices, consent basis, data minimization, deletion workflows, vendor commitments, and restrictions on commercial secondary use. |
| CIPA | For covered E-Rate internet services, enforce internet safety policy and technology protection measures; monitor minors' online activity. | Can help govern agent network actions and record review decisions. | Web filtering, internet safety policy, monitoring process, public meeting/notice where required, education requirements, and E-Rate certifications. |
| NIST AI RMF | Govern, map, measure, and manage AI risks across the AI lifecycle. | Decision logs, approvals, risk events, specialist routing, evidence, local dashboard, and repeatable policy checks. | Model evaluation, bias testing, data quality review, red-team exercises, stakeholder risk acceptance, and lifecycle governance. |
| NIST CSF 2.0 | Govern, identify, protect, detect, respond, and recover cybersecurity risk. | Local evidence for governed actions, command blocking, approval gates, ledger seals, and trace visibility. | MFA, endpoint hardening, vulnerability management, incident response, backups, network segmentation, and recovery plans. |
| CISA K-12 guidance | Prioritize MFA, patching known exploited vulnerabilities, backups, incident response exercises, and training. | Can document AI-agent actions and require approval for risky local operations. | District-wide MFA, patch process, backup program, incident response exercises, security awareness, and vulnerability mitigation. |

## Control Mapping

| Control | SafeLoop status | Notes |
|---------|-----------------|-------|
| Local-only operation | Supports | SafeLoop does not require cloud services or external telemetry. |
| Command allow/block/review | Supports | Applies when commands route through SafeLoop command guard, CLI, MCP gateway, or scenario loop. |
| Human approval | Supports | Approval-required decisions are recorded; production-ready resume workflows should be designed carefully. |
| Audit trail | Supports | Events are written to local JSONL ledgers; malformed lines are skipped on read so valid events remain usable. |
| Ledger tamper evidence | Supports | `safeloop ledger seal` creates a sidecar SHA-256 hash-chain seal. |
| MCP host integration | Supports | SafeLoop exposes stdio MCP tools; hosts must choose those tools for governed actions. |
| Specialist permissions | Supports | Context-aware specialist evaluation can deny inappropriate tool use, such as sales using terminal. |
| Effect mediation | Partial | Effects routed through `guardEffect` or registered adapters are mediated. Missing production-impacting adapters fail closed when expected. |
| Universal tool interception | Not provided | Private tools, raw shell, direct file writes, API calls, network actions, publishing, or deployments bypass SafeLoop if not integrated. |
| OS sandboxing | Not provided | Use endpoint controls, VM/container isolation, file permissions, and least-privilege accounts. |
| Identity/MFA | Not provided | Integrate with district identity systems and administrative procedures. |
| Encryption/key management | Not provided | Configure disk, NAS/SAN, database, and backup encryption outside SafeLoop. |
| Content filtering | Not provided | CIPA filtering and monitoring must be provided by district network/security tools. |
| Legal consent and record rights | Not provided | FERPA/COPPA workflows remain district/vendor responsibilities. |
| RAG answer quality | Not provided | Evaluate ingestion quality, retrieval quality, answer grounding, and hallucination handling separately. |

## K-12 Offline RAG Fit

SafeLoop is strongest when the deployment is designed around cooperative routing:

1. Agents call SafeLoop MCP tools for commands and high-risk effects.
2. Raw shell, unmanaged file tools, direct publishing, and direct network tools are removed or restricted.
3. District staff approve export, delete, network, database reset, and policy-change actions.
4. SafeLoop ledgers and evidence artifacts are reviewed as part of operations.
5. Appliance, NAS/SAN, vector database, scanner/OCR pipeline, identity, and backups are controlled by district IT.

This pattern fits an offline local RAG appliance better than an unrestricted cloud-agent pattern because it keeps source documents, embeddings, prompts, outputs, and audit logs under local administrative control.

## Non-Negotiable Boundary

SafeLoop records and mediates effects routed through `guardEffect`, MCP gateway tools, scenario loops, command guard, or registered adapters. It does not universally intercept private tools, direct file edits, direct API calls, publishing, messaging, deployments, network requests, or process launches unless those paths integrate with SafeLoop.

## References

- FERPA, U.S. Department of Education Student Privacy Policy Office: https://studentprivacy.ed.gov/faq/what-ferpa
- COPPA FAQ, Federal Trade Commission: https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- CIPA guidance, USAC E-Rate: https://www.usac.org/e-rate/applicant-process/starting-services/cipa/
- NIST AI Risk Management Framework: https://www.nist.gov/itl/ai-risk-management-framework
- NIST Cybersecurity Framework 2.0: https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20
- NIST SP 800-53 Rev. 5 control catalog: https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
- CISA Protecting Our Future K-12 report: https://www.cisa.gov/resources-tools/resources/report-protecting-our-future
- CISA K-12 cybersecurity resources: https://www.cisa.gov/stopransomware/k-12-resources
