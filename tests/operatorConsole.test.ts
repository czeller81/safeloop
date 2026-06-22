import { buildMonitorViewModel, buildMonitorDashboardPayload } from '../src/monitor';

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('operatorConsole view model', () => {
  const baseSnapshot = {
    activeLoops: [],
    events: [],
    eventCount: 0,
    monitoredPath: '/tmp/.safeloop',
    lastUpdated: nowIso(),
    costSummary: {
      caseId: 'all',
      totalCost: 0,
      currency: 'USD',
      costByAgent: {},
      costByTask: {},
      costByProject: {},
      costByModel: {},
      costByCase: {},
      usageCount: 0,
    },
    modelUsage: [],
    risks: [],
    approvals: [],
    artifacts: [],
    handoffs: [],
    readiness: { score: 100, verdict: 'ready' },
    steeringInsights: [],
  } as any;

  test('operatorConsole exists in view model', () => {
    const vm = buildMonitorViewModel(baseSnapshot);
    expect(vm.operatorConsole).toBeDefined();
  });

  test('clean snapshot returns watch', () => {
    const vm = buildMonitorViewModel(baseSnapshot);
    expect(vm.operatorConsole?.status).toBe('watch');
  });

  test('unresolved approval produces review and queue item', () => {
    const snap = { ...baseSnapshot };
    snap.events = [
      {
        id: 'ap1',
        type: 'approval.requested',
        summary: 'Approve deployment',
        timestamp: nowIso(),
        caseId: 'case-1',
        agentName: 'ops',
        agentId: 'agent-ops',
        metadata: { approver: 'lead', reason: 'needs human signoff' },
      },
    ];
    snap.eventCount = 1;
    const vm = buildMonitorViewModel(snap);
    expect(vm.operatorConsole?.status).toBe('review');
    const found = vm.operatorConsole?.attentionQueue.find((i) => i.type === 'approval');
    expect(found).toBeDefined();
  });

  test('stale loop appears in attention queue', () => {
    const staleTs = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90m ago (stale threshold)
    const snap = { ...baseSnapshot };
    snap.events = [
      {
        id: 'e1',
        type: 'task.started',
        summary: 'Long running task',
        timestamp: staleTs,
        caseId: 'case-stale',
        agentName: 'stale-agent',
        agentId: 'stale-1',
        metadata: { taskName: 'stale-task' },
      },
    ];
    snap.eventCount = 1;
    const vm = buildMonitorViewModel(snap);
    const found = vm.operatorConsole?.attentionQueue.find((i) => i.type === 'stale_loop');
    expect(found).toBeDefined();
  });

  test('open risk contributes to attention queue', () => {
    const snap = { ...baseSnapshot };
    snap.events = [
      {
        id: 'r1',
        type: 'risk.detected',
        summary: 'Possible data leak',
        timestamp: nowIso(),
        caseId: 'case-risk',
        agentName: 'agentA',
        agentId: 'agA',
        metadata: { severity: 'high' },
      },
    ];
    const vm = buildMonitorViewModel(snap);
    const found = vm.operatorConsole?.attentionQueue.find((i) => i.type === 'warning' || i.type === 'risk');
    expect(found).toBeDefined();
  });

  test('token-cost pulse reflected in summary', () => {
    const snap = { ...baseSnapshot };
    snap.modelUsage = [
      { provider: 'test', model: 'm', inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 2, timestamp: nowIso(), caseId: 'case-1', agent: 'agentA', agentId: 'agA' },
    ];
    const vm = buildMonitorViewModel(snap);
    expect(vm.operatorConsole?.summary.recentTokenTotal).toBeGreaterThan(0);
    expect(vm.operatorConsole?.summary.recentCostTotal).toBeGreaterThanOrEqual(0);
  });

  test('dashboard payload includes operatorConsole', () => {
    const payload = buildMonitorDashboardPayload(baseSnapshot as any);
    expect(payload.viewModel.operatorConsole).toBeDefined();
  });
});
