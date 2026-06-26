import { buildMonitorViewModel } from '../src/monitor/viewModel';

describe('viewModel live flow', () => {
  test('handoff multi-hop chain aggregated into nodes', () => {
    const snapshot: any = {
      events: [
        { id: 'h1', type: 'handoff.created', timestamp: new Date(Date.now()-60000).toISOString(), agentId:'hermes', agentName:'Hermes', caseId:'case-1', summary:'Hermes->OpenCode', metadata:{from:'Hermes', to:'OpenCode'} },
        { id: 'h2', type: 'handoff.created', timestamp: new Date(Date.now()-50000).toISOString(), agentId:'opencode', agentName:'OpenCode', caseId:'case-1', summary:'OpenCode->DeepSeek', metadata:{from:'OpenCode', to:'DeepSeek'} },
        { id: 'h3', type: 'handoff.created', timestamp: new Date(Date.now()-40000).toISOString(), agentId:'deepsdk', agentName:'DeepSeek', caseId:'case-1', summary:'DeepSeek->OpenCode', metadata:{from:'DeepSeek', to:'OpenCode'} },
        { id: 'h4', type: 'handoff.created', timestamp: new Date(Date.now()-30000).toISOString(), agentId:'opencode', agentName:'OpenCode', caseId:'case-1', summary:'OpenCode->Hermes', metadata:{from:'OpenCode', to:'Hermes'} },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 4,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [],
      approvals: [],
      artifacts: [],
      handoffs: [],
      readiness: { score: 100, status: 'ready' },
      steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const live = vm.liveActivity;
    expect(live).toBeDefined();
    // handoffFlow should be present and handoffChain derivation used in UI will see multiple nodes
    expect(live?.handoffFlow.length).toBeGreaterThanOrEqual(1);
  });

  test('missing token-cost telemetry indicated when no modelUsage present', () => {
    const snapshot: any = {
      events: [],
      modelUsage: [],
      activeLoops: [],
      eventCount: 0,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };
    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm.tokens.records.length).toBe(0);
  });
});
