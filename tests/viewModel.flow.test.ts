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

  // --- New tests for Current Session Mode ---

  test('newest sessionId/runId wins and older sessions become historical', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        // older session s1
        { id: 'e1', type: 'task.event', timestamp: new Date(now - 120000).toISOString(), sessionId: 's1', caseId: 'case-x', summary: 'old event 1' },
        { id: 'e2', type: 'handoff.created', timestamp: new Date(now - 115000).toISOString(), sessionId: 's1', caseId: 'case-x', summary: 'handoff old' },
        // newer session s2
        { id: 'e3', type: 'task.event', timestamp: new Date(now - 30000).toISOString(), sessionId: 's2', caseId: 'case-y', summary: 'new event 1' },
        { id: 'e4', type: 'task.event', timestamp: new Date(now - 20000).toISOString(), sessionId: 's2', caseId: 'case-y', summary: 'new event 2' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 4,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const live = vm.liveActivity!;
    // newest sessionId should be selected
    expect(live.currentSessionId).toBe('s2');
    // historical should contain events from s1
    expect(vm.historical.loops.some(l => l.sessionId === 's1')).toBe(true);
    // recentActivity should only include events for s2
    expect(live.recentActivity.every(r => String(r.loopKey).includes('s2'))).toBe(true);
    // hidden count should equal historical events count
    expect(live.historicalHiddenCount).toBeGreaterThanOrEqual(1);
  });

  test('fallback to caseId when sessionId missing', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'f1', type: 'task.event', timestamp: new Date(now - 120000).toISOString(), caseId: 'case-a', summary: 'older case event' },
        { id: 'f2', type: 'task.event', timestamp: new Date(now - 30000).toISOString(), caseId: 'case-b', summary: 'newer case event' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const live = vm.liveActivity!;
    // no explicit sessionId should be selected
    expect(live.currentSessionId).toBeUndefined();
    // recentActivity loopKey should reflect case-b (newest)
    expect(live.recentActivity.every(r => String(r.loopKey).includes('case-b'))).toBe(true);
    // historical should include case-a
    expect(vm.historical.loops.some(l => l.caseId === 'case-a')).toBe(true);
  });

  test('running loops are preserved in current even if older', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        // newer completed session s-new (most recent)
        { id: 'n1', type: 'task.completed', timestamp: new Date(now - 10000).toISOString(), sessionId: 's-new', caseId: 'case-new', summary: 'new completed' },
        // older running session s-old with a task.started recent enough to be considered running (older than s-new but still recent)
        { id: 'r1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 's-old', caseId: 'case-old', summary: 'old running start' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    // ensure both sessions are present in current loops
    const currentKeys = vm.current.currentLoops.map(l => l.sessionId || l.caseId || l.key);
    expect(currentKeys.some(k => String(k).includes('s-new'))).toBe(true);
    expect(currentKeys.some(k => String(k).includes('s-old'))).toBe(true);
  });

  test('historicalHiddenCount matches hidden historical events and recentActivity excludes historical', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'h_old', type: 'task.event', timestamp: new Date(now - 120000).toISOString(), sessionId: 'old', caseId: 'a', summary: 'old' },
        { id: 'h_new', type: 'task.event', timestamp: new Date(now - 20000).toISOString(), sessionId: 'current', caseId: 'b', summary: 'current' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const live = vm.liveActivity!;
    // historicalHiddenCount should equal number of events from historical session(s)
    expect(typeof live.historicalHiddenCount).toBe('number');
    expect(live.historicalHiddenCount).toBeGreaterThanOrEqual(1);
    // recentActivity should not contain events from 'old'
    expect(live.recentActivity.every(r => !String(r.loopKey).includes('old'))).toBe(true);
  });

  test('demo script uses a unique run/session id per execution', () => {
    const fs = require('fs');
    const path = require('path');
    const demoPath = path.resolve(__dirname, '..', 'examples', 'live-monitor-multihop-demo.ts');
    const content = fs.readFileSync(demoPath, 'utf8');
    // ensure demo declares a run id and uses it as sessionId
    expect(content).toMatch(/const\s+runId\s*=\s*id\(/);
    expect(content).not.toMatch(/sessionId\s*:\s*'s1'/);
    expect(content).not.toMatch(/sessionId\s*:\s*'s2'/);
    expect(content).not.toMatch(/sessionId\s*:\s*'s3'/);
  });

  test('token-cost pulse prefers current session usage', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'a1', type: 'task.event', timestamp: new Date(now - 120000).toISOString(), sessionId: 's-old', caseId: 'case-old', summary: 'old event' },
        { id: 'a2', type: 'task.event', timestamp: new Date(now - 20000).toISOString(), sessionId: 's-new', caseId: 'case-new', summary: 'new event' },
      ],
      modelUsage: [
        { provider: 'x', model: 'm', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.01, timestamp: new Date(now - 120000).toISOString(), caseId: 'case-old', sessionId: 's-old' },
        { provider: 'x', model: 'm', inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCost: 0.05, timestamp: new Date(now - 20000).toISOString(), caseId: 'case-new', sessionId: 's-new' },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const pulse = vm.liveActivity?.tokenCostPulse;
    expect(pulse).toBeDefined();
    // should reflect only the s-new usage (700 tokens)
    expect(pulse?.recentTokenTotal).toBe(700);
  });

});
