import { buildMonitorViewModel } from '../src/monitor/viewModel';

function makeEmptySnapshot(): any {
  return {
    events: [],
    modelUsage: [],
    activeLoops: [],
    eventCount: 0,
    monitoredPath: '/tmp',
    lastUpdated: new Date().toISOString(),
    costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
    risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
  };
}

describe('deployment metadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SAFELOOP_MODE;
    delete process.env.SAFELOOP_INSTANCE_ID;
    delete process.env.SAFELOOP_ORG_ID;
    delete process.env.SAFELOOP_PROJECT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('default deployment metadata is local/polling/local data', () => {
    const vm = buildMonitorViewModel(makeEmptySnapshot());
    expect(vm.deployment).toBeDefined();
    expect(vm.deployment!.mode).toBe('local');
    expect(vm.deployment!.label).toBe('Local monitor');
    expect(vm.deployment!.transport).toBe('polling');
    expect(vm.deployment!.dataResidency).toBe('local');
  });

  test('SAFELOOP_MODE=cloud produces cloud metadata', () => {
    process.env.SAFELOOP_MODE = 'cloud';
    process.env.SAFELOOP_INSTANCE_ID = 'inst-abc';
    process.env.SAFELOOP_ORG_ID = 'org-xyz';
    process.env.SAFELOOP_PROJECT_ID = 'proj-123';

    const vm = buildMonitorViewModel(makeEmptySnapshot());
    expect(vm.deployment!.mode).toBe('cloud');
    expect(vm.deployment!.label).toBe('Cloud monitor');
    expect(vm.deployment!.dataResidency).toBe('cloud');
    expect(vm.deployment!.instanceId).toBe('inst-abc');
    expect(vm.deployment!.orgId).toBe('org-xyz');
    expect(vm.deployment!.projectId).toBe('proj-123');
    expect(vm.deployment!.transport).toBe('polling');
  });

  test('invalid SAFELOOP_MODE falls back to unknown safely', () => {
    process.env.SAFELOOP_MODE = 'hybrid-invalid';

    const vm = buildMonitorViewModel(makeEmptySnapshot());
    expect(vm.deployment!.mode).toBe('unknown');
    expect(vm.deployment!.label).toBe('Unknown deployment');
    expect(vm.deployment!.dataResidency).toBe('local');
    expect(vm.deployment!.transport).toBe('polling');
  });

  test('empty/missing SAFELOOP_MODE defaults to local', () => {
    process.env.SAFELOOP_MODE = '';

    const vm = buildMonitorViewModel(makeEmptySnapshot());
    expect(vm.deployment!.mode).toBe('local');
    expect(vm.deployment!.label).toBe('Local monitor');
  });

  test('existing view model fields still present alongside deployment', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'x', model: 'y', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot);
    // All existing sections present
    expect(vm.status).toBeDefined();
    expect(vm.current).toBeDefined();
    expect(vm.historical).toBeDefined();
    expect(vm.spend).toBeDefined();
    expect(vm.tokens).toBeDefined();
    expect(vm.oversight).toBeDefined();
    expect(vm.liveActivity).toBeDefined();
    expect(vm.operatorConsole).toBeDefined();
    expect(vm.circuitGraph).toBeDefined();
    expect(vm.timecardSummary).toBeDefined();
    // deployment is new and present
    expect(vm.deployment).toBeDefined();
    expect(vm.deployment!.mode).toBe('local');
  });
});
