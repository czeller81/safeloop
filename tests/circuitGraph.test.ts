import { buildMonitorViewModel } from '../src/monitor/viewModel';

describe('circuitGraph derivation', () => {
  test('agent nodes are created from current agent statuses', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'hermes', agentName: 'Hermes', summary: 'start' },
        { id: 'e2', type: 'task.started', timestamp: new Date(now - 15000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'opencode', agentName: 'OpenCode', summary: 'coding' },
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
    const graph = vm.circuitGraph;
    expect(graph).toBeDefined();
    expect(graph!.nodes.length).toBeGreaterThanOrEqual(2);

    const hermesNode = graph!.nodes.find(n => n.label === 'Hermes');
    const opencodeNode = graph!.nodes.find(n => n.label === 'OpenCode');
    expect(hermesNode).toBeDefined();
    expect(hermesNode!.type).toBe('agent');
    expect(hermesNode!.status).toBe('active');
    expect(opencodeNode).toBeDefined();
    expect(opencodeNode!.type).toBe('agent');
  });

  test('handoff edges are created from current-session handoff flow', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'h1', type: 'handoff.created', timestamp: new Date(now - 60000).toISOString(), agentId: 'hermes', agentName: 'Hermes', caseId: 'case-1', sessionId: 'run-1', summary: 'Hermes->OpenCode', metadata: { from: 'Hermes', to: 'OpenCode' } },
        { id: 'h2', type: 'handoff.created', timestamp: new Date(now - 50000).toISOString(), agentId: 'opencode', agentName: 'OpenCode', caseId: 'case-1', sessionId: 'run-1', summary: 'OpenCode->DeepSeek', metadata: { from: 'OpenCode', to: 'DeepSeek' } },
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
    const graph = vm.circuitGraph!;

    // Should have handoff edges
    const handoffEdges = graph.edges.filter(e => e.type === 'handoff');
    expect(handoffEdges.length).toBe(2);
    expect(handoffEdges[0].from).toContain('Hermes');
    expect(handoffEdges[0].to).toContain('OpenCode');
    expect(handoffEdges[1].from).toContain('OpenCode');
    expect(handoffEdges[1].to).toContain('DeepSeek');

    // Latest handoff should be active, earlier ones completed
    expect(handoffEdges[0].status).toBe('completed');
    expect(handoffEdges[1].status).toBe('active');

    // Flow path should reflect the chain
    expect(graph.currentFlowPath.length).toBeGreaterThanOrEqual(3);
    expect(graph.currentFlowPath[0]).toContain('Hermes');
    expect(graph.currentFlowPath[1]).toContain('OpenCode');
    expect(graph.currentFlowPath[2]).toContain('DeepSeek');
  });

  test('model usage creates model nodes and model_call edges', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'opencode', agentName: 'OpenCode', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'deepseek', model: 'deepseek-v4', inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimatedCost: 0.003, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'opencode', agent: 'OpenCode', caseId: 'case-1', sessionId: 'run-1', taskName: 'code gen' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.003, currency: 'USD', costByAgent: { OpenCode: 0.003 }, costByTask: {}, costByProject: {}, costByModel: { 'deepseek-v4': 0.003 }, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const graph = vm.circuitGraph!;

    // Should have a model node
    const modelNode = graph.nodes.find(n => n.type === 'model');
    expect(modelNode).toBeDefined();
    expect(modelNode!.label).toContain('deepseek');
    expect(modelNode!.tokenCount).toBe(1500);
    expect(modelNode!.costTotal).toBeCloseTo(0.003);
    expect(modelNode!.pricingAvailable).toBe(true);

    // Should have a model_call edge from OpenCode to the model
    const modelEdge = graph.edges.find(e => e.type === 'model_call');
    expect(modelEdge).toBeDefined();
    expect(modelEdge!.from).toContain('OpenCode');
    expect(modelEdge!.to).toContain('deepseek');
    expect(modelEdge!.status).toBe('active');
  });

  test('pending approval creates a human node and approval_gate edge', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 30000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'opencode', agentName: 'OpenCode', summary: 'start' },
        { id: 'a1', type: 'approval.requested', timestamp: new Date(now - 10000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'opencode', agentName: 'OpenCode', summary: 'Deploy approval needed', metadata: { approver: 'ops-team' } },
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
    const graph = vm.circuitGraph!;

    // Should have a human node
    const humanNode = graph.nodes.find(n => n.type === 'human');
    expect(humanNode).toBeDefined();
    expect(humanNode!.label).toBe('ops-team');
    expect(humanNode!.status).toBe('waiting');

    // Should have an approval_gate edge
    const approvalEdge = graph.edges.find(e => e.type === 'approval_gate');
    expect(approvalEdge).toBeDefined();
    expect(approvalEdge!.from).toContain('OpenCode');
    expect(approvalEdge!.to).toContain('ops-team');
    expect(approvalEdge!.status).toBe('pending');
  });

  test('historical-only mode does not mark stale handoffs as active', () => {
    const now = Date.now();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const snapshot: any = {
      events: [
        { id: 'h1', type: 'handoff.created', timestamp: oldTs, agentId: 'hermes', agentName: 'Hermes', caseId: 'case-old', sessionId: 's1', summary: 'Hermes->OpenCode', metadata: { from: 'Hermes', to: 'OpenCode' } },
        { id: 'e1', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', agentId: 'opencode', agentName: 'OpenCode', summary: 'done' },
      ],
      modelUsage: [
        { provider: 'x', model: 'y', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0, timestamp: oldTs, agentId: 'opencode', agent: 'OpenCode', caseId: 'case-old', sessionId: 's1' },
      ],
      activeLoops: [],
      eventCount: 2,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0, currency: 'USD', costByAgent: {}, costByTask: {}, costByProject: {}, costByModel: {}, costByCase: {}, usageCount: 1 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(true);

    const graph = vm.circuitGraph!;
    // All nodes should be 'completed', not 'active'
    for (const node of graph.nodes) {
      expect(node.status).toBe('completed');
    }
    // All edges should be 'completed', not 'active' or 'pending'
    for (const edge of graph.edges) {
      expect(edge.status).toBe('completed');
    }
    // currentFlowPath should be empty in historical-only mode
    expect(graph.currentFlowPath).toEqual([]);
  });

  test('pricing availability and cost propagate to model nodes', () => {
    const now = Date.now();
    const snapshot: any = {
      events: [
        { id: 'e1', type: 'task.started', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-1', caseId: 'case-1', agentId: 'a1', agentName: 'Agent1', summary: 'start' },
      ],
      modelUsage: [
        { provider: 'openai', model: 'gpt-4', inputTokens: 500, outputTokens: 100, totalTokens: 600, estimatedCost: 0.012, pricingAvailable: true, timestamp: new Date(now - 15000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
        { provider: 'unknown', model: 'mystery', inputTokens: 200, outputTokens: 50, totalTokens: 250, estimatedCost: 0, pricingAvailable: false, timestamp: new Date(now - 12000).toISOString(), agentId: 'a1', agent: 'Agent1', caseId: 'case-1', sessionId: 'run-1' },
      ],
      activeLoops: [],
      eventCount: 1,
      monitoredPath: '/tmp',
      lastUpdated: new Date().toISOString(),
      costSummary: { caseId: 'all', totalCost: 0.012, currency: 'USD', costByAgent: { Agent1: 0.012 }, costByTask: {}, costByProject: {}, costByModel: { 'gpt-4': 0.012 }, costByCase: {}, usageCount: 2 },
      risks: [], approvals: [], artifacts: [], handoffs: [], readiness: { score: 100, status: 'ready' }, steeringInsights: [],
    };

    const vm = buildMonitorViewModel(snapshot as any);
    const graph = vm.circuitGraph!;

    const modelNodes = graph.nodes.filter(n => n.type === 'model');
    expect(modelNodes.length).toBe(2);

    const gpt4Node = modelNodes.find(n => n.label.includes('gpt-4'));
    expect(gpt4Node).toBeDefined();
    expect(gpt4Node!.tokenCount).toBe(600);
    expect(gpt4Node!.costTotal).toBeCloseTo(0.012);
    expect(gpt4Node!.pricingAvailable).toBe(true);

    const mysteryNode = modelNodes.find(n => n.label.includes('mystery'));
    expect(mysteryNode).toBeDefined();
    expect(mysteryNode!.tokenCount).toBe(250);
    expect(mysteryNode!.costTotal).toBe(0);
    expect(mysteryNode!.pricingAvailable).toBe(false);
  });

  test('existing current-session and historical-only behavior still works with circuitGraph present', () => {
    const now = Date.now();
    const recentTs = new Date(now - 10000).toISOString();
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const snapshot: any = {
      events: [
        { id: 'old1', type: 'task.completed', timestamp: oldTs, sessionId: 's1', caseId: 'case-old', summary: 'old done' },
        { id: 'r1', type: 'task.started', timestamp: recentTs, sessionId: 'run-new', caseId: 'case-new', agentId: 'hermes', agentName: 'Hermes', summary: 'new run' },
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

    // Current session detection still works
    expect(vm.liveActivity?.hasCurrentSession).toBe(true);
    expect(vm.liveActivity?.isHistoricalOnly).toBe(false);
    expect(String(vm.liveActivity?.currentSessionId || '').startsWith('run-')).toBe(true);

    // circuitGraph is present and non-empty
    expect(vm.circuitGraph).toBeDefined();
    expect(vm.circuitGraph!.nodes.length).toBeGreaterThanOrEqual(1);
  });
});
