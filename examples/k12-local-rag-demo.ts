import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { appendEvent, readEvents } from '../src/eventStream';
import { sealLedger } from '../src/ledgerIntegrity';
import { initializeSafeloopPolicyConfig } from '../src/policyConfig';
import { runApplianceDoctor } from '../src/applianceDoctor';
import { writeAuditExportBundle } from '../src/auditExport';

export interface K12LocalRagDemoResult {
  baseDir: string;
  eventCount: number;
  policyProfile: string;
  ledgerSealed: boolean;
  applianceOk: boolean;
  auditExportPath: string;
}

function eventId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export function runK12LocalRagDemo(baseDir = resolve(process.cwd(), '.safeloop-k12-demo')): K12LocalRagDemoResult {
  rmSync(baseDir, { recursive: true, force: true });
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(join(baseDir, 'district-docs'), { recursive: true });
  mkdirSync(join(baseDir, 'vector-db'), { recursive: true });

  writeFileSync(
    join(baseDir, 'district-docs', 'board-policy-sample.txt'),
    'Sample local board policy text for SafeLoop K-12 RAG demo.\n',
    'utf8',
  );

  const policy = initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });
  const common = {
    agentId: 'hermes-local',
    agentName: 'Hermes Local',
    caseId: 'k12-rag-demo',
    sessionId: 'demo-session-1',
  };

  appendEvent({
    id: eventId('k12', 1),
    type: 'task.started',
    ...common,
    summary: 'Start local-only district document RAG workflow',
    metadata: { profile: 'k12-offline-rag', internetMode: 'offline' },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 2),
    type: 'artifact.changed',
    ...common,
    summary: 'Document ingestion manifest recorded',
    metadata: {
      path: join(baseDir, 'district-docs', 'board-policy-sample.txt'),
      artifactType: 'ingestion-manifest',
      storage: 'local',
    },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 3),
    type: 'decision.made',
    ...common,
    summary: 'SafeLoop allowed local vector database query',
    metadata: { decision: 'allow', reason: 'Local vector DB query stays inside approved appliance storage.' },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 4),
    type: 'approval.requested',
    ...common,
    summary: 'Approval required before exporting student-data-adjacent summary',
    metadata: { approvalId: 'approval-export-1', approver: 'records_officer', reason: 'External export requires review.' },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 5),
    type: 'approval.resolved',
    ...common,
    summary: 'Records officer approved local evidence export',
    metadata: { approvalId: 'approval-export-1', decision: 'approved', approver: 'records_officer' },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 6),
    type: 'risk.detected',
    ...common,
    summary: 'Student PII export risk acknowledged',
    metadata: { severity: 'medium', mitigation: 'Keep generated output local and cite local source only.' },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 7),
    type: 'token.cost',
    ...common,
    summary: 'Local model token accounting recorded',
    metadata: {
      provider: 'local',
      model: 'district-local-llm',
      inputTokens: 1200,
      outputTokens: 260,
      totalTokens: 1460,
      estimatedCost: 0,
      pricingAvailable: false,
    },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 8),
    type: 'artifact.changed',
    ...common,
    summary: 'Evidence file recorded for approved local answer',
    metadata: {
      path: join(baseDir, 'evidence', 'approved-local-answer.md'),
      artifactType: 'evidence',
      sourceCitations: ['district-docs/board-policy-sample.txt'],
    },
  }, { baseDir });
  appendEvent({
    id: eventId('k12', 9),
    type: 'task.completed',
    ...common,
    summary: 'Completed local-only district RAG demo workflow',
    metadata: { outcome: 'completed', externalNetworkUsed: false },
  }, { baseDir });

  const seal = sealLedger({ baseDir });
  const appliance = runApplianceDoctor({ baseDir, includeMcp: false, profile: 'k12-offline-rag' });
  const audit = writeAuditExportBundle({
    baseDir,
    host: 'generic',
    outPath: join(baseDir, '.safeloop', 'k12-demo-audit-export.json'),
  });

  return {
    baseDir,
    eventCount: readEvents({ baseDir }).length,
    policyProfile: policy.policy.profile ?? 'default',
    ledgerSealed: seal.eventCount > 0,
    applianceOk: appliance.ok,
    auditExportPath: audit.path,
  };
}

if (require.main === module) {
  const result = runK12LocalRagDemo();
  console.log(JSON.stringify(result, null, 2));
}
