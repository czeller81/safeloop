import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getDashboardSnapshot } from '../dist/monitor/dashboardData';
import { buildMonitorViewModel } from '../dist/monitor/viewModel';

function sampleEvents(): string[] {
  const base = new Date().toISOString();
  return [
    JSON.stringify({ id: 'e1', type: 'task.started', agentId: 'hermes-1', agentName: 'Hermes', caseId: 'case-dogfood-001', sessionId: 'sess-1', summary: 'Start feeding task', metadata: { project: 'Safeloop', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e2', type: 'artifact.changed', agentId: 'hermes-1', agentName: 'Hermes', caseId: 'case-dogfood-001', sessionId: 'sess-1', summary: 'Attached feeding-spec.md', metadata: { project: 'Safeloop', path: '/tmp/feeding-spec.md', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e3', type: 'handoff.created', agentId: 'hermes-1', agentName: 'Hermes', caseId: 'case-dogfood-001', sessionId: 'sess-1', summary: 'Handoff Hermes -> OpenCode', metadata: { project: 'Safeloop', from: 'Hermes', to: 'OpenCode', fromId: 'hermes-1', toId: 'opencode-1', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e4', type: 'decision.made', agentId: 'opencode-1', agentName: 'OpenCode', caseId: 'case-dogfood-001', sessionId: 'sess-2', summary: 'Implement schedule with retry', metadata: { project: 'Safeloop', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am', rationale: 'Retry ensures temporary API faults do not stop feeding' }, timestamp: base }),
    JSON.stringify({ id: 'e5', type: 'approval.requested', agentId: 'opencode-1', agentName: 'OpenCode', caseId: 'case-dogfood-001', sessionId: 'sess-2', summary: 'Request approval', metadata: { project: 'Safeloop', approver: 'ops@local', reason: 'Consistency guarantees for feeder', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e6', type: 'approval.resolved', agentId: 'ops-1', agentName: 'Ops', caseId: 'case-dogfood-001', sessionId: 'sess-2', summary: 'Approval granted', metadata: { project: 'Safeloop', approvalId: 'approval-1', decision: 'approved', approver: 'ops@local', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e7', type: 'task.completed', agentId: 'opencode-1', agentName: 'OpenCode', caseId: 'case-dogfood-001', sessionId: 'sess-2', summary: 'Feeder control loop implemented', metadata: { project: 'Safeloop', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
    JSON.stringify({ id: 'e8', type: 'report.generated', agentId: 'opencode-1', agentName: 'OpenCode', caseId: 'case-dogfood-001', sessionId: 'sess-2', summary: 'Hydrated case report', metadata: { project: 'Safeloop', path: '/tmp/feeding-report.md', taskId: 'task-feed-dog-001', taskName: 'Feed the dog daily at 8am' }, timestamp: base }),
  ];
}

describe('dogfood monitor baseDir', () => {
  it('loads dogfood ledger via baseDir and exposes loop in dashboard', () => {
    const tmpDir = resolve(process.cwd(), 'tests', '.safeloop-dogfood-test');
    mkdirSync(tmpDir, { recursive: true });
    const eventsPath = resolve(tmpDir, '.safeloop', 'events.jsonl');
    mkdirSync(resolve(tmpDir, '.safeloop'), { recursive: true });
    writeFileSync(eventsPath, sampleEvents().join('\n') + '\n', 'utf8');

    const snapshot = getDashboardSnapshot({ baseDir: tmpDir });
    const view = buildMonitorViewModel(snapshot);

    // Find loop for the dogfood case
    const found = view.oversight.loopTimecards.find((l: any) => l.caseId === 'case-dogfood-001' || l.taskName === 'Feed the dog daily at 8am');
    expect(found).toBeDefined();
    if (!found) return;
    const f: any = found;
    expect(f.project).toBe('Safeloop');
    expect(f.handoffsCount).toBeGreaterThanOrEqual(1);
    expect(f.artifactsCount).toBeGreaterThanOrEqual(1);
    expect(f.approvalsStatus).toBe('approved');
    expect(f.status).toBe('completed');
    // analyzer should not mark missing attribution
    expect(f.anomalies && f.anomalies.find((a: any) => a.code === 'missing_attribution')).toBeUndefined();
    expect(typeof f.oversightScore).toBe('number');
    expect(f.recommendedAction).toBeTruthy();
  });
});
