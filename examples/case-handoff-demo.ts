import {
  addCaseContext,
  createCaseFile,
  exportCaseReportJSON,
  exportCaseReportMarkdown,
  recordCaseDecision,
  requestCaseApproval,
  resolveCaseApproval,
  recordHandoff,
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

  caseFile = caseFile.attachArtifact({
    type: 'file',
    label: 'README',
    path: './README.md',
    description: 'Project overview and current feature map',
  });

  caseFile = caseFile.attachArtifact({
    type: 'report',
    label: 'Safety Report',
    path: './SAFELOOP_REPORT.md',
    description: 'Generated case report used for handoff review',
  });

  caseFile = recordCaseDecision(caseFile, {
    decision: 'Implement Case Files as standalone TypeScript modules',
    rationale: 'Preserve existing APIs while adding accountability and handoff',
    relatedContextIds: [caseFile.contextTrail[0].id],
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
    from: 'Hermes',
    to: 'OpenCode',
    notes: 'Continue from the approved case file and keep the ledger trail intact.',
    recommendedNextActions: ['Review README', 'Review safety report', 'Continue implementation'],
    attachmentIds: caseFile.listAttachments().map((attachment) => attachment.id),
  });

  console.log(exportCaseReportMarkdown(caseFile));
  console.log('\n--- JSON ---\n');
  console.log(JSON.stringify(exportCaseReportJSON(caseFile), null, 2));
}

main();
