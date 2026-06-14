import {
  addParticipant,
  createAgentSession,
  createCaseFile,
  exportAgentSessionMarkdown,
  exportAgentSessionJSON,
} from '../src/index';

function main(): void {
  let caseFile = createCaseFile({
    goal: 'Show a Hermes-led adapter flow',
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

  const session = createAgentSession({
    adapter: {
      id: 'hermes-1',
      name: 'Hermes',
      agentType: 'hermes',
      capabilities: {
        canReadFiles: true,
        canWriteFiles: true,
        canRequestApproval: true,
        canHandoff: true,
        canGenerateReports: true,
      },
    },
    caseFile,
  });

  session.emit({
    id: 'evt-1',
    type: 'task.started',
    timestamp: '2026-06-14T01:00:00.000Z',
    agentId: 'hermes-1',
    agentName: 'Hermes',
    participantId: 'Hermes',
    caseId: caseFile.id,
    summary: 'Hermes starts the adapter protocol task',
    metadata: {
      goal: 'Create the agent adapter protocol',
      project: 'Safeloop',
      owner: 'Hermes',
    },
  });

  session.emit({
    id: 'evt-2',
    type: 'decision.made',
    timestamp: '2026-06-14T01:01:00.000Z',
    agentId: 'opencode-1',
    agentName: 'OpenCode',
    participantId: 'OpenCode',
    caseId: caseFile.id,
    summary: 'OpenCode records the implementation approach',
    metadata: {
      decision: 'Use explicit lifecycle events and a session recorder',
      rationale: 'Keep the protocol agent-agnostic and local-first',
    },
  });

  session.emit({
    id: 'evt-3',
    type: 'approval.requested',
    timestamp: '2026-06-14T01:02:00.000Z',
    agentId: 'hermes-1',
    agentName: 'Hermes',
    participantId: 'Hermes',
    caseId: caseFile.id,
    summary: 'Hermes requests approval for the adapter surface',
    metadata: {
      reason: 'Need approval before exposing the new protocol publicly',
      approver: 'Charles',
    },
  });

  session.emit({
    id: 'evt-4',
    type: 'approval.resolved',
    timestamp: '2026-06-14T01:03:00.000Z',
    agentId: 'charles-1',
    agentName: 'Charles',
    participantId: 'Charles',
    caseId: caseFile.id,
    summary: 'Charles approves the adapter protocol',
    metadata: {
      approvalId: session.caseFile.approvals[0].id,
      decision: 'approved',
      approver: 'Charles',
      note: 'Approved for local use',
    },
  });

  session.emit({
    id: 'evt-5',
    type: 'handoff.created',
    timestamp: '2026-06-14T01:04:00.000Z',
    agentId: 'hermes-1',
    agentName: 'Hermes',
    participantId: 'Hermes',
    caseId: caseFile.id,
    summary: 'Hermes records the handoff to OpenCode',
    metadata: {
      from: 'Hermes',
      to: 'OpenCode',
      notes: 'Continue the implementation and keep the protocol additive',
      recommendedNextActions: ['Update docs', 'Preserve backwards compatibility'],
    },
  });

  session.emit({
    id: 'evt-6',
    type: 'report.generated',
    timestamp: '2026-06-14T01:05:00.000Z',
    agentId: 'hermes-1',
    agentName: 'Hermes',
    participantId: 'Hermes',
    caseId: caseFile.id,
    summary: 'Safeloop generates the session report and manifest-ready trail',
    metadata: {
      reportType: 'handoff-report',
      path: 'reports/hermes-adapter.md',
    },
  });

  session.complete();

  const handoffManifest = session.createHandoffManifest();

  console.log(exportAgentSessionMarkdown(session));
  console.log(JSON.stringify(exportAgentSessionJSON(session), null, 2));
  console.log(JSON.stringify(handoffManifest, null, 2));
}

main();
