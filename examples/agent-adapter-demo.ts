import {
  addParticipant,
  createAgentSession,
  createCaseFile,
  exportAgentSessionJSON,
  exportAgentSessionMarkdown,
} from '../src/index';

function main(): void {
  let caseFile = createCaseFile({
    goal: 'Demonstrate the agent adapter protocol',
    owner: 'Hermes',
    project: 'Safeloop',
  });

  caseFile = addParticipant(caseFile, {
    id: 'Hermes',
    name: 'Hermes',
    type: 'agent',
    role: 'owner',
  });

  caseFile = addParticipant(caseFile, {
    id: 'GenericAgent',
    name: 'Generic Agent',
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
      id: 'generic-agent-1',
      name: 'Generic Agent',
      agentType: 'custom',
      version: '1.0.0',
      capabilities: {
        canReadFiles: true,
        canWriteFiles: true,
        canRunCommands: true,
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
    timestamp: '2026-06-14T00:00:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Start the agent-agnostic session',
    metadata: {
      goal: 'Demonstrate the agent adapter protocol',
      project: 'Safeloop',
      owner: 'Hermes',
    },
  });

  session.emit({
    id: 'evt-2',
    type: 'context.loaded',
    timestamp: '2026-06-14T00:01:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Loaded README and protocol context',
    metadata: {
      source: 'README.md',
      notes: ['Keep everything explicit', 'Stay local-first'],
      references: ['README.md', 'docs/AGENT_ADAPTER_PROTOCOL.md'],
    },
  });

  session.emit({
    id: 'evt-3',
    type: 'decision.made',
    timestamp: '2026-06-14T00:02:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Use explicit lifecycle events for every agent',
    metadata: {
      decision: 'Use explicit lifecycle events for every agent',
      rationale: 'Safeloop should accept work from wrappers, scripts, or humans',
      tradeoffs: ['Requires adapters to emit events intentionally'],
    },
  });

  session.emit({
    id: 'evt-4',
    type: 'risk.detected',
    timestamp: '2026-06-14T00:03:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Adapters could become hidden telemetry',
    metadata: {
      risk: 'Adapters could become hidden telemetry',
      severity: 'medium',
      mitigation: 'Only accept explicit event payloads',
    },
  });

  session.emit({
    id: 'evt-5',
    type: 'approval.requested',
    timestamp: '2026-06-14T00:04:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Request approval for the adapter design',
    metadata: {
      reason: 'Need approval before exposing the new protocol',
      approver: 'Charles',
      references: ['README.md'],
    },
  });

  session.emit({
    id: 'evt-6',
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
      note: 'Approved for local use',
    },
  });

  session.emit({
    id: 'evt-7',
    type: 'artifact.changed',
    timestamp: '2026-06-14T00:06:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Added agentAdapter.ts',
    metadata: {
      path: 'src/agentAdapter.ts',
      artifactType: 'file',
      changeSummary: 'Added the adapter protocol and session recorder',
    },
  });

  session.emit({
    id: 'evt-8',
    type: 'handoff.created',
    timestamp: '2026-06-14T00:07:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Hand off to the next implementer',
    metadata: {
      from: 'GenericAgent',
      to: 'Hermes',
      notes: 'Continue with docs and README updates',
      recommendedNextActions: ['Update docs', 'Export the session report'],
    },
  });

  session.emit({
    id: 'evt-9',
    type: 'task.completed',
    timestamp: '2026-06-14T00:08:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Complete the generic agent session',
    metadata: {
      result: 'success',
      outputSummary: 'Protocol, recorder, docs, and examples are in place',
    },
  });

  session.emit({
    id: 'evt-10',
    type: 'report.generated',
    timestamp: '2026-06-14T00:09:00.000Z',
    agentId: 'generic-agent-1',
    agentName: 'Generic Agent',
    participantId: 'GenericAgent',
    caseId: caseFile.id,
    summary: 'Generated the session report',
    metadata: {
      reportType: 'agent-session',
      path: 'reports/agent-session.md',
    },
  });

  session.complete();

  const queryReport = session.createQueryReport({
    type: 'release-readiness',
    includeEvidence: true,
    includeRisks: true,
    includeApprovals: true,
    includeAttachments: true,
  });

  const handoffManifest = session.createHandoffManifest();

  console.log(exportAgentSessionMarkdown(session));
  console.log(JSON.stringify(exportAgentSessionJSON(session), null, 2));
  console.log(JSON.stringify(queryReport, null, 2));
  console.log(JSON.stringify(handoffManifest, null, 2));
}

main();
