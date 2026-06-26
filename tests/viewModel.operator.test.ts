import { buildMonitorViewModel } from '../src/monitor/viewModel';

describe('viewModel operator events', () => {
  test('operator.action.recorded updates attention queue item state', () => {
    const snapshot: any = {
      events: [
        { id: 'a1', type: 'approval.requested', timestamp: new Date().toISOString(), agentId: 'agent1', agentName: 'A1', caseId: 'case-1', summary: 'Approve X', metadata: { approver: 'lead' } },
        { id: 'op1', type: 'operator.action.recorded', timestamp: new Date().toISOString(), agentId: 'op', agentName: 'Operator', caseId: 'case-1', summary: 'ack', metadata: { action: 'acknowledged', targetId: 'a1', note: 'ok' } },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp/.safeloop',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      modelUsage: [],
      risks: [],
      approvals: [],
      artifacts: [],
      handoffs: [],
      readiness: { score: 100, status: 'ready' },
      steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const item = vm.operatorConsole?.attentionQueue.find((i) => i.id === 'a1' || i.title.includes('Approve X'));
    expect(item).toBeDefined();
    expect(item?.state === 'acknowledged' || item?.lastOperatorAction === 'acknowledged').toBeTruthy();
    expect(item?.operatorNote === 'ok' || item?.lastOperatorAction === 'acknowledged').toBeTruthy();
  });
});
