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

  test('do not promote newest historical into current; prefer running loop', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        // historical loop with newest lastTimestamp
        { id: 'h1', type: 'task.event', timestamp: new Date(now - 1000).toISOString(), sessionId: 'hist', caseId: 'case-h', summary: 'historical recent' },
        { id: 'h2', type: 'task.completed', timestamp: new Date(now - 1000).toISOString(), sessionId: 'hist', caseId: 'case-h', summary: 'historical completed' },
        // running loop older than the historical one
        { id: 'r1', type: 'task.started', timestamp: new Date(now - 60000).toISOString(), sessionId: 'run', caseId: 'case-r', summary: 'running start' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 3,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    // latestRun should be the running loop, not the newest historical
    const latest = vm.current.latestRun;
    expect(latest).toBeTruthy();
    expect(latest?.sessionId).toBe('run');
    // historicalHiddenCount should be > 0
    expect(vm.liveActivity?.historicalHiddenCount ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('historical-only ledger does not present an active current session', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', summary: 'historical completed' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm.liveActivity?.hasCurrentSession).toBe(false);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(true);
    expect(vm.liveActivity?.currentSessionId).toBeUndefined();
    expect(vm.liveActivity?.historicalHiddenCount ?? 0).toBeGreaterThanOrEqual(1);
    // current loops may be present for display/readiness compatibility; the liveActivity.isHistoricalOnly flag
    // ensures the UI renders an explicit historical-only cue instead of marking the session as active.
  });

  test('fresh run wins over old historical ledger and marks hidden historical count', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const recentTs = new Date(now - 10000).toISOString();
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', summary: 'historical completed' },
        { id: 'r1', type: 'task.started', timestamp: recentTs, sessionId: 'run-123', caseId: 'case-live', summary: 'fresh run start' },
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
    expect(vm.liveActivity?.hasCurrentSession).toBe(true);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(false);
    expect(String(vm.liveActivity?.currentSessionId || '').startsWith('run-')).toBe(true);
    expect(vm.liveActivity?.historicalHiddenCount ?? 0).toBeGreaterThanOrEqual(1);
    // recentActivity should reflect the fresh run
    expect(vm.liveActivity?.recentActivity.every(r => String(r.loopKey).includes('run-'))).toBe(true);
  });

});



describe('pricingAvailable flag', () => {
  test('pricingAvailable is false when no usage records have non-zero cost', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'unknown-provider', model: 'unknown-model', inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimatedCost: 0, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1', taskName: 'test task' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);

    // spend.pricingAvailable should be false
    expect(vm.spend.pricingAvailable).toBe(false);

    // latestRun should have pricingAvailable = false
    expect(vm.current.latestRun).toBeTruthy();
    expect(vm.current.latestRun!.pricingAvailable).toBe(false);

    // tokenCostPulse should reflect pricing unavailable
    expect(vm.liveActivity?.tokenCostPulse.pricingAvailable).toBe(false);

    // token counts should still be present
    expect(vm.current.latestRun!.totalTokens).toBe(1500);
    expect(vm.current.latestRun!.inputTokens).toBe(1200);
    expect(vm.current.latestRun!.outputTokens).toBe(300);
  });

  test('pricingAvailable is true when usage records have non-zero estimated cost', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-2', caseId: 'case-2', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCost: 0.042, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-2', sessionId: 'run-2', taskName: 'real task' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.042, currency: 'USD', costByAgent: { Agent1: 0.042 }, costByTask: { 'real task': 0.042 }, costByProject: {}, costByModel: { 'gpt-4': 0.042 }, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);

    // spend.pricingAvailable should be true
    expect(vm.spend.pricingAvailable).toBe(true);

    // latestRun should have pricingAvailable = true
    expect(vm.current.latestRun).toBeTruthy();
    expect(vm.current.latestRun!.pricingAvailable).toBe(true);
    expect(vm.current.latestRun!.estimatedCost).toBeCloseTo(0.042);

    // tokenCostPulse should reflect pricing available
    expect(vm.liveActivity?.tokenCostPulse.pricingAvailable).toBe(true);
  });

  test('real zero cost still shows $0.0000 when pricingAvailable is true', () => {
    // Edge case: pricing IS configured and cost happens to be $0 (e.g., free tier model)
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-3', caseId: 'case-3', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      // Simulate: one model with real pricing and cost, another with pricing configured but $0 cost
      modelUsage: [
        { provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.005, pricingAvailable: true, timestamp: new Date(now - 18000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-3', sessionId: 'run-3', taskName: 'paid call' },
        { provider: 'free-tier', model: 'free-v1', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-3', sessionId: 'run-3', taskName: 'free call' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.005, currency: 'USD', costByAgent: { Agent1: 0.005 }, costByTask: {}, costByProject: {}, costByModel: { 'gpt-4': 0.005 }, costByCase: {}, usageCount: 2 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);

    // At least one record has pricingAvailable=true, so bucket should be true
    expect(vm.spend.pricingAvailable).toBe(true);
    expect(vm.current.latestRun!.pricingAvailable).toBe(true);
  });

  test('pricingAvailable true with estimatedCost 0 means real free model (not missing pricing)', () => {
    // A model with pricing configured that legitimately costs $0 (free tier)
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-free', caseId: 'case-free', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'local', model: 'llama-free', inputTokens: 800, outputTokens: 200, totalTokens: 1000, estimatedCost: 0, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-free', sessionId: 'run-free', taskName: 'free run' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);

    // pricingAvailable should be true even though cost is $0
    expect(vm.spend.pricingAvailable).toBe(true);
    expect(vm.current.latestRun!.pricingAvailable).toBe(true);
    expect(vm.current.latestRun!.estimatedCost).toBe(0);
    // Token counts remain visible
    expect(vm.current.latestRun!.totalTokens).toBe(1000);
  });

  test('existing historical-only and current-session behavior does not regress', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', summary: 'historical completed' },
      ],
      modelUsage: [
        { provider: 'x', model: 'y', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0, timestamp: oldTs, agentId: 'a', caseId: 'case-old', sessionId: 's1' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    // historical-only flag should still work
    expect(vm.liveActivity?.isHistoricalOnly).toBe(true);
    expect(vm.liveActivity?.hasCurrentSession).toBe(false);
    // pricing unavailable flag should be false (cost is 0, no pricing found)
    expect(vm.spend.pricingAvailable).toBe(false);
  });
});



describe('formatCostOrUnavailable', () => {
  // Import the formatter
  const { formatCostOrUnavailable, formatCurrency } = require('../src/monitor/ui/lib/formatters');

  test('returns dash with no pricing message when pricingAvailable is false', () => {
    const result = formatCostOrUnavailable(0, false);
    expect(result).toBe('\u2014 (no pricing)');
  });

  test('returns dash with no pricing message even when value is non-zero but pricing unavailable', () => {
    // This scenario shouldn't happen in practice but tests the guard
    const result = formatCostOrUnavailable(0.05, false);
    expect(result).toBe('\u2014 (no pricing)');
  });

  test('returns formatted currency when pricingAvailable is true and cost is zero', () => {
    const result = formatCostOrUnavailable(0, true);
    expect(result).toBe(formatCurrency(0, 'USD'));
    expect(result).toContain('$0.0000');
  });

  test('returns formatted currency when pricingAvailable is true and cost is non-zero', () => {
    const result = formatCostOrUnavailable(0.0042, true);
    expect(result).toContain('$0.0042');
  });
});
