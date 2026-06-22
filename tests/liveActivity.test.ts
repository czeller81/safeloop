import { buildMonitorViewModel } from '../src/monitor/viewModel';

describe('LiveActivity view model', () => {
  it('exposes liveActivity fields and derives handoff flow and token pulse', () => {
    const now = new Date();
    const isoNow = now.toISOString();
    const earlier = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    const snapshot: any = {
      lastUpdated: isoNow,
      monitoredPath: '/tmp',
      eventCount: 4,
      modelUsage: [
        { model: 'deepseek-v4-flash', inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimatedCost: 0.0, timestamp: isoNow, agentId: 'opencode-1', agent: 'OpenCode', caseId: 'case-1', taskName: 'Feed the dog' },
      ],
      events: [
        { id: 'e1', type: 'handoff.created', caseId: 'case-1', sessionId: 'sess-1', timestamp: earlier, summary: 'Hermes -> OpenCode', agentId: 'hermes-1', agentName: 'Hermes', metadata: { from: 'Hermes', to: 'OpenCode' } },
        { id: 'e2', type: 'approval.requested', caseId: 'case-1', sessionId: 'sess-1', timestamp: isoNow, summary: 'Request approval', agentId: 'opencode-1', agentName: 'OpenCode', metadata: { approver: 'ops@local' } },
        { id: 'e3', type: 'risk.detected', caseId: 'case-1', sessionId: 'sess-1', timestamp: isoNow, summary: 'High cost', agentId: 'opencode-1', agentName: 'OpenCode', metadata: { severity: 'high' } },
      ],
      costSummary: {
        totalCost: 0,
        currency: 'USD',
        usageCount: 1,
        costByAgent: { 'OpenCode': 0 },
        costByModel: { 'deepseek-v4-flash': 0 },
        costByProject: {},
        costByTask: {},
      },
    };

    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm).toBeDefined();
    const live = (vm as any).liveActivity;
    expect(live).toBeDefined();
    expect(Array.isArray(live.activeAgents)).toBe(true);
    expect(Array.isArray(live.recentActivity)).toBe(true);
    expect(Array.isArray(live.handoffFlow)).toBe(true);
    expect(live.handoffFlow.length).toBeGreaterThanOrEqual(1);
    expect(live.tokenCostPulse.recentTokenTotal).toBeGreaterThan(0);
    // approval pending inference
    const waiting = Object.values(live.agentStatuses || {}).some((s: any) => s.status === 'waiting_for_approval');
    expect(waiting).toBe(true);
  });
});
