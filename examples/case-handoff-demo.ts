import {
  addCaseContext,
  addParticipant,
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
  });

  caseFile = addParticipant(caseFile, {
    id: 'OpenCode',
    name: 'OpenCode',
    type: 'agent',
    role: 'implementer',
  });

  caseFile = addParticipant(caseFile, {
    id: 'Charles',
    name: 'Charles',
    type: 'human',
    role: 'approver',
  });

  caseFile = addCaseContext(caseFile, {
    contextUsed: 'Existing policy gate, breaker, ledger, and report concepts',
    references: ['src/index.ts', '.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
    notes: ['Keep the layer local-first and additive'],
    createdBy: 'Hermes',
  });

  caseFile = recordCaseDecision(caseFile, {
    decision: 'Implement Case File attribution as standalone participant metadata',
    rationale: 'Preserve existing APIs while adding accountability and handoff attribution',
    relatedContextIds: [caseFile.contextTrail[0].id],
    createdBy: 'OpenCode',
  });

  caseFile = recordCaseRisk(caseFile, {
    risk: 'Work may lose attribution during handoff',
    severity: 'medium',
    mitigation: 'Store participant IDs on the context trail, approvals, and handoffs',
    createdBy: 'OpenCode',
  });

  caseFile = requestCaseApproval(caseFile, {
    subject: 'Approve Case File attribution layer',
    requestedBy: 'Hermes',
    requestedByParticipantId: 'Hermes',
    requestedFor: 'Charles',
    reason: 'Ready for review before handoff',
    references: ['SAFELOOP_CASE.md'],
  });

  caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
    status: 'approved',
    approver: 'Charles',
    resolvedByParticipantId: 'Charles',
    note: 'Proceed',
  });

  caseFile = recordHandoff(caseFile, {
    from: 'Hermes',
    to: 'OpenCode',
    fromParticipantId: 'Hermes',
    toParticipantId: 'OpenCode',
    notes: 'Continue from the approved case file and keep the ledger trail intact.',
    recommendedNextActions: ['Review README', 'Review safety report', 'Continue implementation'],
    attachmentIds: caseFile.listAttachments().map((attachment) => attachment.id),
  });

  console.log(exportCaseReportMarkdown(caseFile));
  console.log('\n--- JSON ---\n');
  console.log(JSON.stringify(exportCaseReportJSON(caseFile), null, 2));
}

main();
