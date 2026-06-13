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

describe('case report exports', () => {
  it('exports markdown and JSON for a complete case', () => {
    const caseFile = createCaseFile({
      goal: 'Add accountability and handoff reporting',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode'],
    });

    const withContext = addCaseContext(caseFile, {
      contextUsed: 'Existing ledger/report model',
      references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
      notes: ['Keep output local-first'],
    });

    const withDecision = recordCaseDecision(withContext, {
      decision: 'Add a standalone Case File layer',
      rationale: 'Preserve current breaker behavior while adding handoff structure',
    });

    const withRisk = recordCaseRisk(withDecision, {
      risk: 'Users confuse the Case File with the breaker runtime',
      severity: 'low',
      mitigation: 'Document the layer as additive and standalone',
    });

    const requested = requestCaseApproval(withRisk, {
      subject: 'Proceed with implementation',
      requestedBy: 'Hermes',
      requestedFor: 'Charles',
      reason: 'Need approval before changing ownership',
      references: ['SAFELOOP_CASE.md'],
    });

    const resolved = resolveCaseApproval(requested, requested.approvals[0].id, {
      status: 'approved',
      approver: 'Charles',
      note: 'Approved',
    });

    const withHandoff = recordHandoff(resolved, {
      nextOwner: 'OpenCode',
      handoffNotes: 'Start from the approved case file and keep the ledger trail intact.',
      recommendedNextActions: ['Review current state', 'Continue coding'],
      references: ['.safeloop/ledger.jsonl'],
    });

    const md = exportCaseReportMarkdown(withHandoff);
    const json = exportCaseReportJSON(withHandoff);

    expect(md).toContain('# Case Report');
    expect(md).toContain('Goal: Add accountability and handoff reporting');
    expect(md).toContain('## Context Trail');
    expect(md).toContain('.safeloop/ledger.jsonl');
    expect(md).toContain('SAFELOOP_CASE.md');
    expect(md).toContain('## Decision Log');
    expect(md).toContain('## Risk Tracking');
    expect(md).toContain('## Approvals');
    expect(md).toContain('## Handoff Records');
    expect(md).toContain('OpenCode');

    expect(json.summary).toEqual({
      contextEntries: 1,
      decisions: 1,
      risks: 1,
      approvals: 1,
      handoffs: 1,
      lastApprovalStatus: 'approved',
    });
    expect(json.caseFile.owner).toBe('OpenCode');
    expect(json.caseFile.status).toBe('handed_off');
    expect(json.caseFile.approvals[0].status).toBe('approved');
  });

  it('exports a minimal case safely', () => {
    const caseFile = createCaseFile({
      goal: 'Minimal report',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    const md = exportCaseReportMarkdown(caseFile);
    const json = exportCaseReportJSON(caseFile);

    expect(md).toContain('Status: open');
    expect(md).toContain('None');
    expect(json.summary).toEqual({
      contextEntries: 0,
      decisions: 0,
      risks: 0,
      approvals: 0,
      handoffs: 0,
      lastApprovalStatus: 'none',
    });
  });
});
