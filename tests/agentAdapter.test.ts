import {
  addCaseContext,
  addParticipant,
  createAgentSession,
  createCaseFile,
  exportAgentSessionJSON,
  exportAgentSessionMarkdown,
  processAgentEvent,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from '../src/index';

describe('agent adapter protocol', () => {
  function buildCaseFile() {
    let caseFile = createCaseFile({
      goal: 'Build the Safeloop adapter protocol',
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

    return caseFile;
  }

  it('records lifecycle events into the case file in order', () => {
    const caseFile = buildCaseFile();
    const session = createAgentSession({
      adapter: {
        id: 'hermes-1',
        name: 'Hermes',
        agentType: 'hermes',
        version: '1.0.0',
        capabilities: {
          canReadFiles: true,
          canWriteFiles: true,
          canRunCommands: true,
          canRequestApproval: true,
          canHandoff: true,
        },
      },
      caseFile,
    });

    session.emit({
      id: 'event-1',
      type: 'task.started',
      timestamp: '2026-06-14T00:00:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Start the adapter protocol work',
      metadata: {
        goal: 'Build the Safeloop adapter protocol',
        project: 'Safeloop',
        owner: 'Hermes',
      },
    });

    session.emit({
      id: 'event-2',
      type: 'context.loaded',
      timestamp: '2026-06-14T00:01:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Loaded README and prior report/query context',
      metadata: {
        source: 'README.md',
        notes: ['Keep the protocol local-first', 'Do not break existing APIs'],
        references: ['README.md', 'docs/PRODUCT_BLUEPRINT.md'],
      },
    });

    session.emit({
      id: 'event-3',
      type: 'decision.made',
      timestamp: '2026-06-14T00:02:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Use an explicit lifecycle event protocol',
      metadata: {
        decision: 'Use an explicit lifecycle event protocol',
        rationale: 'Any agent can emit events without the runtime being Hermes-only',
        tradeoffs: ['Requires wrapper integration', 'Preserves local explicit control'],
      },
    });

    session.emit({
      id: 'event-4',
      type: 'risk.detected',
      timestamp: '2026-06-14T00:03:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Adapter wrappers could drift into hidden capture',
      metadata: {
        risk: 'Adapter wrappers could drift into hidden capture',
        severity: 'high',
        mitigation: 'Only transform explicit events into Case File records',
      },
    });

    session.emit({
      id: 'event-5',
      type: 'approval.requested',
      timestamp: '2026-06-14T00:04:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Request approval for adapter exports',
      metadata: {
        reason: 'Need approval before exposing adapter exports',
        approver: 'Charles',
        references: ['README.md'],
      },
    });

    session.emit({
      id: 'event-6',
      type: 'approval.resolved',
      timestamp: '2026-06-14T00:05:00.000Z',
      agentId: 'charles-1',
      agentName: 'Charles',
      participantId: 'Charles',
      caseId: caseFile.id,
      summary: 'Approve the adapter protocol',
      metadata: {
        approvalId: session.caseFile.approvals[0].id,
        decision: 'approved',
        approver: 'Charles',
        note: 'Approved for local-first agent-agnostic use',
      },
    });

    session.emit({
      id: 'event-7',
      type: 'artifact.changed',
      timestamp: '2026-06-14T00:06:00.000Z',
      agentId: 'opencode-1',
      agentName: 'OpenCode',
      participantId: 'OpenCode',
      caseId: caseFile.id,
      summary: 'Added the adapter module',
      metadata: {
        path: 'src/agentAdapter.ts',
        artifactType: 'file',
        changeSummary: 'Added the agent adapter protocol and session recorder',
      },
    });

    session.emit({
      id: 'event-8',
      type: 'handoff.created',
      timestamp: '2026-06-14T00:07:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Hand off implementation to OpenCode',
      metadata: {
        from: 'Hermes',
        to: 'OpenCode',
        notes: 'Continue with README and docs updates.',
        recommendedNextActions: ['Update README', 'Add examples'],
      },
    });

    session.emit({
      id: 'event-9',
      type: 'task.completed',
      timestamp: '2026-06-14T00:08:00.000Z',
      agentId: 'opencode-1',
      agentName: 'OpenCode',
      participantId: 'OpenCode',
      caseId: caseFile.id,
      summary: 'Adapter protocol implementation completed',
      metadata: {
        result: 'success',
        outputSummary: 'Protocol, session recorder, docs, and examples are in place',
      },
    });

    session.emit({
      id: 'event-10',
      type: 'report.generated',
      timestamp: '2026-06-14T00:09:00.000Z',
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Generated the adapter session report',
      metadata: {
        reportType: 'agent-session',
        path: 'docs/AGENT_SESSION.md',
      },
    });

    session.complete();

    expect(session.adapter.agentType).toBe('hermes');
    expect(session.events.map((event) => event.type)).toEqual([
      'task.started',
      'context.loaded',
      'decision.made',
      'risk.detected',
      'approval.requested',
      'approval.resolved',
      'artifact.changed',
      'handoff.created',
      'task.completed',
      'report.generated',
    ]);
    expect(session.caseFile.contextTrail).toHaveLength(2);
    expect(session.caseFile.decisionLog.map((entry) => entry.decision)).toEqual(
      expect.arrayContaining([
        'Use an explicit lifecycle event protocol',
        'Task completed: success',
      ]),
    );
    expect(session.caseFile.riskLog).toHaveLength(1);
    expect(session.caseFile.approvals).toHaveLength(1);
    expect(session.caseFile.approvals[0]).toMatchObject({
      status: 'approved',
      approver: 'Charles',
    });
    expect(session.caseFile.attachments).toHaveLength(2);
    expect(session.caseFile.handoffRecords).toHaveLength(1);
    expect(session.caseFile.status).toBe('completed');
    expect(session.completedAt).toBeDefined();
  });

  it('exports session summaries to markdown and JSON', () => {
    const caseFile = buildCaseFile();
    const session = createAgentSession({
      adapter: {
        id: 'generic-1',
        name: 'Generic Agent',
        agentType: 'custom',
        capabilities: {
          canReadFiles: true,
          canWriteFiles: false,
          canRunCommands: false,
          canRequestApproval: true,
          canHandoff: true,
          canGenerateReports: true,
        },
      },
      caseFile,
    });

    session.emit({
      id: 'event-a',
      type: 'task.started',
      timestamp: '2026-06-14T01:00:00.000Z',
      agentId: 'generic-1',
      summary: 'Start a generic agent flow',
      metadata: {
        goal: 'Demonstrate the adapter protocol',
        project: 'Safeloop',
        owner: 'Hermes',
      },
    });

    session.emit({
      id: 'event-b',
      type: 'report.generated',
      timestamp: '2026-06-14T01:01:00.000Z',
      agentId: 'generic-1',
      summary: 'Generated the session report',
      metadata: {
        reportType: 'session-summary',
        path: 'reports/session-summary.md',
      },
    });

    const markdown = exportAgentSessionMarkdown(session);
    const json = exportAgentSessionJSON(session);

    expect(markdown).toContain('# Safeloop Agent Session');
    expect(markdown).toContain('## Agent');
    expect(markdown).toContain('## Events');
    expect(markdown).toContain('## Decisions');
    expect(markdown).toContain('## Risks');
    expect(markdown).toContain('## Approvals');
    expect(markdown).toContain('## Artifacts');
    expect(markdown).toContain('## Handoffs');
    expect(markdown).toContain('## Completion');
    expect(markdown).toContain('## Generated Reports');
    expect(markdown).toContain('task.started');
    expect(markdown).toContain('report.generated');
    expect(json.adapter.agentType).toBe('custom');
    expect(json.events).toHaveLength(2);
    expect(json.summary.eventCount).toBe(2);
    expect(json.generatedReports).toHaveLength(1);
    expect(json.generatedReports[0].path).toBe('reports/session-summary.md');
  });

  it('processAgentEvent updates case files directly and stays compatible with existing APIs', () => {
    let caseFile = createCaseFile({
      goal: 'Check compatibility',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    caseFile = addCaseContext(caseFile, {
      contextUsed: 'Existing Case File APIs still work',
      notes: ['Compatibility check'],
      createdBy: 'Hermes',
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

    caseFile = recordCaseDecision(caseFile, {
      decision: 'Keep the adapter layer additive',
      rationale: 'Do not break the existing Case File APIs',
      createdBy: 'Hermes',
    });

    caseFile = recordCaseRisk(caseFile, {
      risk: 'Adapter changes break existing behavior',
      severity: 'low',
      mitigation: 'Add tests before implementation',
      createdBy: 'Hermes',
    });

    caseFile = requestCaseApproval(caseFile, {
      subject: 'Approve compatibility check',
      requestedBy: 'Hermes',
      requestedByParticipantId: 'Hermes',
      requestedFor: 'Charles',
    });

    caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
      status: 'approved',
      approver: 'Charles',
      resolvedByParticipantId: 'Charles',
    });

    caseFile = recordHandoff(caseFile, {
      from: 'Hermes',
      to: 'OpenCode',
      fromParticipantId: 'Hermes',
      toParticipantId: 'OpenCode',
      handoffNotes: 'Continue the compatibility check',
      recommendedNextActions: ['Review the adapter protocol'],
    });

    const nextCaseFile = processAgentEvent(caseFile, {
      id: 'compat-event',
      type: 'context.loaded',
      timestamp: '2026-06-14T02:00:00.000Z',
      agentId: 'hermes-1',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Loaded compatibility context',
      metadata: {
        source: 'tests/agentAdapter.test.ts',
        notes: ['Explicit event handling only'],
      },
    });

    expect(nextCaseFile.contextTrail).toHaveLength(2);
    expect(nextCaseFile.decisionLog).toHaveLength(1);
    expect(nextCaseFile.approvals).toHaveLength(1);
    expect(nextCaseFile.handoffRecords).toHaveLength(1);
  });
});
