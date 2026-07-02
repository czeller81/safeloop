import { buildMonitorViewModel } from '../src/monitor/viewModel';

describe('billable agent timecard summary', () => {
  test('current loop with tokens creates a billable timecard candidate', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'hermes', agentName: 'Hermes', summary: 'planning' },
        { id: 'e2', type: 'task.completed', timestamp: new Date(now - 5000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'hermes', agentName: 'Hermes', summary: 'done' },
      ],
      modelUsage: [
        { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCost: 0.04, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'hermes', agent: 'Hermes', caseId: 'case-1', sessionId: 'run-1', taskName: 'planning' },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.04, currency: 'USD', costByAgent: { Hermes: 0.04 }, costByTask: {}, costByProject: {}, costByModel: { 'gpt-4': 0.04 }, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const tc = vm.timecardSummary;
    expect(tc).toBeDefined();
    expect(tc!.current.length).toBeGreaterThanOrEqual(1);

    const card = tc!.current[0];
    expect(card.billableCandidate).toBe(true);
    expect(card.totalTokens).toBe(1200);
    expect(card.estimatedCost).toBeCloseTo(0.04);
    expect(card.pricingAvailable).toBe(true);
    expect(card.status).toBe('completed');
    expect(card.agentName).toBe('Hermes');
  });

  test('historical loop creates a historical timecard', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const recentTs = new Date(now - 10000).toISOString();
    const snapshot: any = {
      events: [
        // old completed loop
        { id: 'old1', type: 'task.started', timestamp: oldTs, sessionId: 's-old', caseId: 'case-old', agentId: 'a1', agentName: 'OldAgent', summary: 'old start' },
        { id: 'old2', type: 'task.completed', timestamp: oldTs, sessionId: 's-old', caseId: 'case-old', agentId: 'a1', agentName: 'OldAgent', summary: 'old done' },
        // recent running loop
        { id: 'r1', type: 'task.started', timestamp: recentTs, sessionId: 'run-new', caseId: 'case-new', agentId: 'hermes', agentName: 'Hermes', summary: 'new start' },
      ],
      modelUsage: [
        { provider: 'x', model: 'y', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0, timestamp: oldTs, agentId: 'a1', agent: 'OldAgent', caseId: 'case-old', sessionId: 's-old' },
      ],
      activeLoops: [],
      eventCount: 3,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const tc = vm.timecardSummary!;
    expect(tc.historical.length).toBeGreaterThanOrEqual(1);
    const histCard = tc.historical.find(c => c.sessionId === 's-old');
    expect(histCard).toBeDefined();
    expect(histCard!.totalTokens).toBe(600);
  });

  test('token counts aggregate correctly across the summary', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'x', model: 'a', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0.01, pricingAvailable: true, timestamp: new Date(now - 18000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
        { provider: 'x', model: 'b', inputTokens: 300, outputTokens: 200, totalTokens: 500, estimatedCost: 0.02, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.03, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 2 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const tc = vm.timecardSummary!;
    expect(tc.totals.totalTokens).toBe(1100);
    expect(tc.totals.totalEstimatedCost).toBeCloseTo(0.03);
  });

  test('pricing unavailable is represented correctly on timecards', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
        { id: 'e2', type: 'task.completed', timestamp: new Date(now - 5000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'done' },
      ],
      modelUsage: [
        { provider: 'unknown', model: 'mystery', inputTokens: 800, outputTokens: 200, totalTokens: 1000, estimatedCost: 0, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const tc = vm.timecardSummary!;
    const card = tc.current[0];
    expect(card.pricingAvailable).toBe(false);
    expect(card.estimatedCost).toBe(0);
    // Token counts still present
    expect(card.totalTokens).toBe(1000);
    expect(card.inputTokens).toBe(800);
    expect(card.outputTokens).toBe(200);
    // totals level
    expect(tc.totals.pricingAvailable).toBe(false);
  });

  test('handoff/approval/artifact/risk counts aggregate on timecards', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 30000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
        { id: 'h1', type: 'handoff.created', timestamp: new Date(now - 25000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'handoff', metadata: { from: 'A', to: 'B' } },
        { id: 'h2', type: 'handoff.created', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'handoff2', metadata: { from: 'B', to: 'C' } },
        { id: 'ap1', type: 'approval.requested', timestamp: new Date(now - 15000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'approve?', metadata: { approver: 'ops' } },
        { id: 'art1', type: 'artifact.changed', timestamp: new Date(now - 12000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'file changed', metadata: { path: '/tmp/x' } },
        { id: 'r1', type: 'risk.detected', timestamp: new Date(now - 10000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'risk!', metadata: { severity: 'high' } },
        { id: 'e2', type: 'task.completed', timestamp: new Date(now - 5000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'done' },
      ],
      modelUsage: [],
      activeLoops: [],
      eventCount: 7,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 0 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const tc = vm.timecardSummary!;
    const card = tc.current[0];
    expect(card.handoffCount).toBe(2);
    expect(card.approvalCount).toBeGreaterThanOrEqual(1);
    expect(card.artifactCount).toBe(1);
    expect(card.riskCount).toBe(1);
    // billable because it has handoffs and artifacts
    expect(card.billableCandidate).toBe(true);
  });

  test('historical-only fallback completed loop with tokens is NOT a current billable candidate', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.started', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'old start' },
        { id: 'old2', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'old done' },
        { id: 'old3', type: 'handoff.created', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'handoff', metadata: { from: 'A', to: 'B' } },
      ],
      modelUsage: [
        { provider: 'x', model: 'y', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0.01, pricingAvailable: true, timestamp: oldTs, agentId: 'a1', agent: 'Agent1', caseId: 'case-old', sessionId: 's1' },
      ],
      activeLoops: [],
      eventCount: 3,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.01, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(true);

    const tc = vm.timecardSummary!;
    // The fallback-promoted loop should NOT be a billable candidate
    for (const card of tc.current) {
      expect(card.billableCandidate).toBe(false);
      expect(card.billableReason).toContain('Historical-only fallback');
    }
    // billableCandidateCount should be 0
    expect(tc.totals.billableCandidateCount).toBe(0);
  });

  test('historical-only fallback does not increase billable candidate count in totals', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.started', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
        { id: 'old2', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'done' },
        { id: 'art1', type: 'artifact.changed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'a1', agentName: 'Agent1', summary: 'file', metadata: { path: '/x' } },
      ],
      modelUsage: [
        { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCost: 0.05, pricingAvailable: true, timestamp: oldTs, agentId: 'a1', agent: 'Agent1', caseId: 'case-old', sessionId: 's1' },
      ],
      activeLoops: [],
      eventCount: 3,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.05, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(true);
    // Even though the loop has tokens+artifacts+completed status (would normally be billable),
    // in historical-only mode it must not count as billable
    expect(vm.timecardSummary!.totals.billableCandidateCount).toBe(0);
  });

  test('existing circuitGraph, evidence stream, and session behavior still works', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'hermes', agentName: 'Hermes', summary: 'start' },
        { id: 'h1', type: 'handoff.created', timestamp: new Date(now - 15000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'hermes', agentName: 'Hermes', summary: 'Hermes->OpenCode', metadata: { from: 'Hermes', to: 'OpenCode' } },
      ],
      modelUsage: [
        { provider: 'deepseek', model: 'v4', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0.002, pricingAvailable: true, timestamp: new Date(now - 12000).toISOString(), agentId: 'hermes', agent: 'Hermes', caseId: 'case-1', sessionId: 'run-1' },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.002, currency: 'USD', costByAgent: { Hermes: 0.002 }, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);

    // circuitGraph still present
    expect(vm.circuitGraph).toBeDefined();
    expect(vm.circuitGraph!.nodes.length).toBeGreaterThanOrEqual(1);

    // liveActivity still present with eventType on recentActivity
    expect(vm.liveActivity).toBeDefined();
    expect(vm.liveActivity!.recentActivity.length).toBeGreaterThanOrEqual(1);
    expect(vm.liveActivity!.recentActivity[0].eventType).toBeDefined();

    // timecardSummary present alongside everything else
    expect(vm.timecardSummary).toBeDefined();
    expect(vm.timecardSummary!.totals.totalTokens).toBe(600);

    // session detection works
    expect(vm.liveActivity!.hasCurrentSession).toBe(true);
  });
});
