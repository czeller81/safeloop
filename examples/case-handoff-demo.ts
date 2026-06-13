import {
  addCaseContext,
  createCaseFile,
  exportCaseReportJSON,
  exportCaseReportMarkdown,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from '../src/index';

function main(): void {
  let caseFile = createCaseFile({
    goal: 'Hand off the current Safeloop implementation safely',
    owner: 'Hermes',
    project: 'Safeloop',
    participants: ['Hermes', 'OpenCode'],
  });

  caseFile = addCaseContext(caseFile, {
    contextUsed: 'Existing policy gate, breaker, ledger, and report concepts',
    references: ['src/index.ts', '.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
    notes: ['Keep the layer local-first and additive'],
  });

  caseFile = recordCaseDecision(caseFile, {
    decision: 'Implement Case Files as standalone TypeScript modules',
    rationale: 'Preserve existing APIs while adding accountability and handoff',
    relatedContextIds: [caseFile.contextTrail[0].id],
  });

  caseFile = recordCaseRisk(caseFile, {
    risk: 'Coupling the new layer too tightly to the breaker runtime',
    severity: 'medium',
    mitigation: 'Keep the Case File API standalone and export-only',
  });

  caseFile = requestCaseApproval(caseFile, {
    subject: 'Approve Case File layer',
    requestedBy: 'Hermes',
    requestedFor: 'Charles',
    reason: 'Ready for review before handoff',
    references: ['SAFELOOP_CASE.md'],
  });

  caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
    status: 'approved',
    approver: 'Charles',
    note: 'Proceed',
  });

  caseFile = recordHandoff(caseFile, {
    currentOwner: 'Hermes',
    nextOwner: 'OpenCode',
    handoffNotes: 'Continue from the approved case file and keep the ledger trail intact.',
    recommendedNextActions: ['Review context trail', 'Continue implementation'],
    references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
  });

  console.log(exportCaseReportMarkdown(caseFile));
  console.log('\n--- JSON ---\n');
  console.log(JSON.stringify(exportCaseReportJSON(caseFile), null, 2));
}

main();
