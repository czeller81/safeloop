import {
  addCaseContext,
  createCaseFile,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from '../src/index';

describe('case file layer', () => {
  it('creates a case file with safe defaults', () => {
    const caseFile = createCaseFile({
      goal: 'Hand off the next coding task',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode', 'Hermes'],
    });

    expect(caseFile.goal).toBe('Hand off the next coding task');
    expect(caseFile.owner).toBe('Hermes');
    expect(caseFile.project).toBe('Safeloop');
    expect(caseFile.status).toBe('open');
    expect(caseFile.participants).toEqual(['Hermes', 'OpenCode']);
    expect(caseFile.contextTrail).toEqual([]);
    expect(caseFile.decisionLog).toEqual([]);
    expect(caseFile.riskLog).toEqual([]);
    expect(caseFile.approvals).toEqual([]);
    expect(caseFile.handoffRecords).toEqual([]);
    expect(caseFile.closedAt).toBeNull();
  });

  it('records context, decisions, risks, approvals, and handoffs immutably', () => {
    const caseFile = createCaseFile({
      goal: 'Add Agent Accountability + Handoff',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode'],
    });

    const withContext = addCaseContext(caseFile, {
      contextUsed: 'Existing ledger and markdown report concepts',
      references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
      notes: ['Keep the case layer standalone'],
    });

    const withDecision = recordCaseDecision(withContext, {
      decision: 'Use a small file-based Case File model',
      rationale: 'Add accountability without coupling the breaker runtime',
      relatedContextIds: [withContext.contextTrail[0].id],
    });

    const withRisk = recordCaseRisk(withDecision, {
      risk: 'Over-coupling the new layer to the breaker runtime',
      severity: 'medium',
      mitigation: 'Keep the API additive and export-only',
    });

    const withApprovalRequest = requestCaseApproval(withRisk, {
      subject: 'Approve the handoff boundary',
      requestedBy: 'Hermes',
      requestedFor: 'Charles',
      reason: 'Need approval before cutting over ownership',
      references: ['SAFELOOP_CASE.md'],
    });

    const approvalId = withApprovalRequest.approvals[0].id;
    const withApprovalResolved = resolveCaseApproval(
      withApprovalRequest,
      approvalId,
      {
        status: 'approved',
        approver: 'Charles',
        note: 'Looks good',
      },
    );

    const withHandoff = recordHandoff(withApprovalResolved, {
      currentOwner: 'Hermes',
      nextOwner: 'OpenCode',
      handoffNotes: 'Continue from the approved case file and preserve the ledger trail.',
      recommendedNextActions: ['Review the context trail', 'Continue implementation'],
      references: ['.safeloop/ledger.jsonl', 'SAFELOOP_CASE.md'],
    });

    expect(caseFile.contextTrail).toHaveLength(0);
    expect(withContext.contextTrail).toHaveLength(1);
    expect(withDecision.decisionLog).toHaveLength(1);
    expect(withRisk.riskLog).toHaveLength(1);
    expect(withApprovalRequest.status).toBe('awaiting_approval');
    expect(withApprovalRequest.approvals[0].status).toBe('requested');
    expect(withApprovalResolved.approvals[0]).toMatchObject({
      status: 'approved',
      approver: 'Charles',
      note: 'Looks good',
    });
    expect(withApprovalResolved.status).toBe('open');
    expect(withHandoff.owner).toBe('OpenCode');
    expect(withHandoff.status).toBe('handed_off');
    expect(withHandoff.participants).toContain('OpenCode');
    expect(withHandoff.handoffRecords).toHaveLength(1);
    expect(caseFile.participants).toEqual(['Hermes', 'OpenCode']);
  });

  it('rejects unknown approval ids', () => {
    const caseFile = createCaseFile({
      goal: 'Test approval resolution',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    expect(() =>
      resolveCaseApproval(caseFile, 'missing-approval', {
        status: 'rejected',
        approver: 'Charles',
      }),
    ).toThrow('Approval not found: missing-approval');
  });
});
