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

describe('case workflow', () => {
  it('supports a full accountability and handoff flow', () => {
    let caseFile = createCaseFile({
      goal: 'Implement the Agent Accountability + Handoff layer',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode'],
    });

    caseFile = addCaseContext(caseFile, {
      contextUsed: 'Existing policy gate, breaker, and ledger architecture',
      references: ['src/index.ts', 'tests/breaker.test.ts'],
      notes: ['Keep existing behavior unchanged'],
    });

    caseFile = recordCaseDecision(caseFile, {
      decision: 'Build the new layer as additive modules',
      rationale: 'Preserve the breaker API and add accountability above it',
      relatedContextIds: [caseFile.contextTrail[0].id],
    });

    caseFile = recordCaseRisk(caseFile, {
      risk: 'Unexpected coupling with the breaker runtime',
      severity: 'medium',
      mitigation: 'Keep the Case File layer standalone and export-only',
    });

    caseFile = requestCaseApproval(caseFile, {
      subject: 'Approve the plan',
      requestedBy: 'Hermes',
      requestedFor: 'Charles',
      reason: 'The plan is ready for review',
      references: ['README.md'],
    });

    caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
      status: 'approved',
      approver: 'Charles',
      note: 'Proceed',
    });

    caseFile = recordHandoff(caseFile, {
      currentOwner: 'Hermes',
      nextOwner: 'OpenCode',
      handoffNotes: 'Continue with implementation and keep the ledger/report layer intact.',
      recommendedNextActions: ['Review README', 'Run validation'],
      references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
    });

    const md = exportCaseReportMarkdown(caseFile);
    const json = exportCaseReportJSON(caseFile);

    expect(caseFile.status).toBe('handed_off');
    expect(caseFile.owner).toBe('OpenCode');
    expect(caseFile.participants).toContain('OpenCode');
    expect(md).toContain('Implement the Agent Accountability + Handoff layer');
    expect(md).toContain('README.md');
    expect(json.caseFile.decisionLog).toHaveLength(1);
    expect(json.caseFile.riskLog).toHaveLength(1);
    expect(json.caseFile.handoffRecords).toHaveLength(1);
  });
});
