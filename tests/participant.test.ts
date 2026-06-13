import {
  addCaseContext,
  addParticipant,
  createCaseFile,
  exportCaseReportJSON,
  exportCaseReportMarkdown,
  getParticipant,
  hasParticipant,
  listParticipants,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from '../src/index';

describe('participant attribution', () => {
  it('creates participants, prevents duplicates, and supports lookup helpers', () => {
    let caseFile = createCaseFile({
      goal: 'Track participant identity',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    caseFile = addParticipant(caseFile, {
      id: 'OpenCode',
      name: 'OpenCode',
      type: 'agent',
      role: 'reviewer',
    });

    caseFile = addParticipant(caseFile, {
      id: 'Charles',
      name: 'Charles Zeller',
      type: 'human',
      role: 'approver',
    });

    expect(() =>
      addParticipant(caseFile, {
        id: 'OpenCode',
        name: 'OpenCode Duplicate',
        type: 'agent',
        role: 'observer',
      }),
    ).toThrow('Participant already exists: OpenCode');

    expect(hasParticipant(caseFile, 'Hermes')).toBe(true);
    expect(hasParticipant(caseFile, 'OpenCode')).toBe(true);
    expect(getParticipant(caseFile, 'Charles')).toMatchObject({
      id: 'Charles',
      name: 'Charles Zeller',
      type: 'human',
      role: 'approver',
    });

    expect(listParticipants(caseFile).map((participant) => participant.name)).toEqual([
      'Hermes',
      'OpenCode',
      'Charles Zeller',
    ]);
  });

  it('tracks attribution across the case lifecycle and exports it', () => {
    let caseFile = createCaseFile({
      goal: 'Track accountability with attribution',
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
      name: 'Charles Zeller',
      type: 'human',
      role: 'approver',
    });

    caseFile = addCaseContext(caseFile, {
      contextUsed: 'Legacy case file support and attribution metadata',
      references: ['README.md'],
      createdBy: 'Hermes',
    });

    caseFile = recordCaseDecision(caseFile, {
      decision: 'Store attribution on each record',
      rationale: 'Keep case files portable and reviewable',
      createdBy: 'OpenCode',
    });

    caseFile = recordCaseRisk(caseFile, {
      risk: 'Losing accountability during handoff',
      severity: 'medium',
      mitigation: 'Attach participant IDs to records',
      createdBy: 'OpenCode',
    });

    caseFile = requestCaseApproval(caseFile, {
      subject: 'Approve attribution layer',
      requestedBy: 'Hermes',
      requestedByParticipantId: 'Hermes',
      requestedFor: 'Charles Zeller',
    });

    caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
      status: 'approved',
      approver: 'Charles Zeller',
      resolvedByParticipantId: 'Charles',
    });

    caseFile = recordHandoff(caseFile, {
      from: 'Hermes',
      to: 'OpenCode',
      fromParticipantId: 'Hermes',
      toParticipantId: 'OpenCode',
      handoffNotes: 'Continue with attribution-aware work',
      recommendedNextActions: ['Review the report'],
    });

    const markdown = exportCaseReportMarkdown(caseFile);
    const json = exportCaseReportJSON(caseFile);

    expect(markdown).toContain('## Participants');
    expect(markdown).toContain('## Participants Summary');
    expect(markdown).toContain('By: Hermes');
    expect(markdown).toContain('By: OpenCode');
    expect(markdown).toContain('By: Charles Zeller');
    expect(markdown).toContain('Current owner: Hermes');
    expect(markdown).toContain('Next owner: OpenCode');
    expect(json.caseFile.contextTrail[0]).toMatchObject({ createdBy: 'Hermes' });
    expect(json.caseFile.decisionLog[0]).toMatchObject({ createdBy: 'OpenCode' });
    expect(json.caseFile.riskLog[0]).toMatchObject({ createdBy: 'OpenCode' });
    expect(json.caseFile.approvals[0]).toMatchObject({
      requestedByParticipantId: 'Hermes',
      resolvedByParticipantId: 'Charles',
    });
    expect(json.caseFile.handoffRecords[0]).toMatchObject({
      fromParticipantId: 'Hermes',
      toParticipantId: 'OpenCode',
    });
  });

  it('remains compatible with older case files that do not include attribution fields', () => {
    const legacyCaseFile = {
      id: 'case-legacy',
      goal: 'Legacy compatibility',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode'],
      status: 'open',
      contextTrail: [],
      decisionLog: [],
      riskLog: [],
      approvals: [],
      handoffRecords: [],
      attachments: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      closedAt: null,
    } as unknown as Parameters<typeof exportCaseReportJSON>[0];

    expect(listParticipants(legacyCaseFile).map((participant) => participant.id)).toEqual([
      'Hermes',
      'OpenCode',
    ]);
    expect(getParticipant(legacyCaseFile, 'Hermes')).toMatchObject({
      id: 'Hermes',
      name: 'Hermes',
      role: 'owner',
    });
    expect(exportCaseReportMarkdown(legacyCaseFile)).toContain('## Participants');
    expect(exportCaseReportJSON(legacyCaseFile).caseFile.participants).toEqual([
      'Hermes',
      'OpenCode',
    ]);
  });
});
