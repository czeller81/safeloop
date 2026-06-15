import { analyzeLoopOversight } from '../src/oversightAnalyzer';

describe('oversightAnalyzer', () => {
  test('healthy loop should score high and not be marked stale', () => {
    const healthyLoop: any = {
      _events: [
        { id: 'e1', type: 'task.started', timestamp: '2026-06-15T09:00:00.000Z', summary: 'start', metadata: {} },
        { id: 'e2', type: 'decision.made', timestamp: '2026-06-15T09:00:10.000Z', summary: 'decide', metadata: { rationale: 'docs-only', severity: 'low' } },
        { id: 'e3', type: 'decision.explained', timestamp: '2026-06-15T09:00:11.000Z', summary: 'explain', metadata: { rationale: 'small change' } },
        { id: 'e4', type: 'model.usage', timestamp: '2026-06-15T09:00:12.000Z', summary: 'usage', metadata: { estimatedCost: 0.001 } },
        { id: 'e5', type: 'approval.requested', timestamp: '2026-06-15T09:00:14.000Z', summary: 'ask', metadata: { approver: 'owner' } },
        { id: 'e6', type: 'approval.resolved', timestamp: '2026-06-15T09:00:20.000Z', summary: 'approve', metadata: { decision: 'approved' } },
        { id: 'e7', type: 'task.completed', timestamp: '2026-06-15T09:00:40.000Z', summary: 'done', metadata: { outputSummary: 'ok' } },
      ],
      _usageRecords: [ { estimatedCost: 0.001 } ],
      status: 'completed',
      lastTimestamp: '2026-06-15T09:00:40.000Z',
      firstTimestamp: '2026-06-15T09:00:00.000Z',
      durationMs: 40000,
      totalTokens: 60,
      estimatedCost: 0.001,
      approvalsStatus: 'approved',
      project: 'Safeloop',
      taskId: 'task-healthy-1',
      caseId: 'case-healthy',
      agentId: 'hermes-1',
    };

    const collection: any = { historical: [] };
    const result = analyzeLoopOversight(healthyLoop, collection);
    expect(result.oversightScore).toBeGreaterThanOrEqual(80);
    expect(result.oversightLevel).toBe('healthy');
    expect(result.warnings.find((w) => w.code === 'stale_loop')).toBeUndefined();
    expect(result.recommendedAction).not.toBe('investigate_stale_loop');
  });

  test('problematic loop should be flagged needs_review or critical', () => {
    const probLoop: any = {
      _events: [
        { id: 'p1', type: 'task.started', timestamp: '2026-05-01T08:00:00.000Z', summary: 'start', metadata: {} },
        { id: 'p2', type: 'model.usage', timestamp: '2026-05-01T08:00:05.000Z', summary: 'usage', metadata: { estimatedCost: 0 } },
        { id: 'p3', type: 'risk.detected', timestamp: '2026-05-01T08:00:06.000Z', summary: 'high risk', metadata: { severity: 'high' } },
        { id: 'p4', type: 'approval.requested', timestamp: '2026-05-01T08:00:07.000Z', summary: 'ask', metadata: { approver: 'owner' } },
        { id: 'p5', type: 'decision.made', timestamp: '2026-05-01T08:00:08.000Z', summary: 'decide without rationale', metadata: { decision: 'apply_patch', severity: 'high' } },
      ],
      _usageRecords: [ { estimatedCost: 0 } ],
      status: 'running',
      lastTimestamp: '2026-05-01T08:00:08.000Z',
      firstTimestamp: '2026-05-01T08:00:00.000Z',
      durationMs: 100000000,
      totalTokens: 2100,
      estimatedCost: 0,
      approvalsStatus: 'pending',
      project: '',
      taskId: '',
      caseId: 'case-problem',
      agentId: 'hermes-2',
    };

    const collection: any = { historical: [] };
    const result = analyzeLoopOversight(probLoop, collection);
    expect(result.oversightScore).toBeLessThan(80);
    expect(['needs_review', 'critical', 'watch']).toContain(result.oversightLevel);
    expect(result.anomalies.find((a) => a.code === 'missing_attribution')).toBeTruthy();
    expect(result.anomalies.find((a) => a.code === 'unresolved_approval')).toBeTruthy();
  });
});
