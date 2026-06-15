import { createServer } from 'http';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildMonitorDashboardPayload,
  appendEvent,
  calculateCost,
  calculateReadinessScore,
  compareSteeringRuns,
  detectGoalDrift,
  getCaseCostSummary,
  getDashboardSnapshot,
  readTokenCosts,
  recordModelUsage,
  recordTokenCost,
  recordSteeringProfile,
  readEvents,
  renderMonitorHtml,
  setModelPricing,
  startMonitorServer,
  streamEvents,
} from '../src/index';
import { summarizeLoopSummaries } from '../src/monitor/server';

describe('Safeloop v0.7 observability layer', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v07-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('appends and reads deterministic local-only event stream records', async () => {
    appendEvent(
      {
        id: 'evt-1',
        type: 'task.started',
        timestamp: '2026-06-14T10:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-1',
        summary: 'Start the live loop monitor',
        metadata: { goal: 'Build the monitor' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-2',
        type: 'decision.made',
        timestamp: '2026-06-14T10:01:00.000Z',
        agentId: 'opencode-1',
        agentName: 'OpenCode',
        caseId: 'case-1',
        summary: 'Use a local JSONL event stream',
        metadata: { decision: 'JSONL event stream' },
      },
      { baseDir },
    );

    const events = readEvents({ baseDir });
    const streamed: string[] = [];
    for await (const event of streamEvents({ baseDir })) {
      streamed.push(event.type);
    }

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(['task.started', 'decision.made']);
    expect(events[0].summary).toBe('Start the live loop monitor');
    expect(events[1].metadata).toEqual({ decision: 'JSONL event stream' });
    expect(streamed).toEqual(['task.started', 'decision.made']);

    const jsonl = readFileSync(join(baseDir, '.safeloop', 'events.jsonl'), 'utf8');
    expect(jsonl).toContain('task.started');
    expect(jsonl).toContain('decision.made');
  });

  it('summarizes a complete loop into an AI worker timecard', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-start',
        type: 'task.started',
        timestamp: '2026-06-14T10:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Start dogfood live monitor cost accountability',
      },
      { baseDir },
    );

    recordModelUsage(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 10000,
        outputTokens: 1000,
        agentId: 'hermes-1',
        agent: 'Hermes',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        caseId: 'case-dogfood',
        timestamp: '2026-06-14T10:02:00.000Z',
      },
      { baseDir },
    );

    recordTokenCost(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 8000,
        outputTokens: 1200,
        agentId: 'hermes-1',
        agent: 'Hermes',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        caseId: 'case-dogfood',
        timestamp: '2026-06-14T10:03:00.000Z',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-risk',
        type: 'risk.detected',
        timestamp: '2026-06-14T10:04:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Overlap risk surfaced',
        metadata: { severity: 'medium' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-approval-requested',
        type: 'approval.requested',
        timestamp: '2026-06-14T10:05:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Request approval for monitor polish',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-approval-resolved',
        type: 'approval.resolved',
        timestamp: '2026-06-14T10:06:00.000Z',
        agentId: 'charles',
        agentName: 'Charles',
        caseId: 'case-dogfood',
        summary: 'Approval granted',
        metadata: { decision: 'approved' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-artifact',
        type: 'artifact.changed',
        timestamp: '2026-06-14T10:07:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Monitor server updated',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-handoff',
        type: 'handoff.created',
        timestamp: '2026-06-14T10:08:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Handoff to review',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-complete',
        type: 'task.completed',
        timestamp: '2026-06-14T10:09:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Monitor polish complete',
      },
      { baseDir },
    );

    const snapshot = getDashboardSnapshot({ baseDir });
    const loopState = summarizeLoopSummaries(snapshot);
    const latest = loopState.latest;

    expect(latest).toBeTruthy();
    expect(latest?.taskName).toBe('Dogfood live monitor cost accountability');
    expect(latest?.agent).toBe('Hermes');
    expect(latest?.project).toBe('Safeloop');
    expect(latest?.status).toBe('completed');
    expect(latest?.eventCount).toBe(9);
    expect(latest?.inputTokens).toBe(18000);
    expect(latest?.outputTokens).toBe(2200);
    expect(latest?.totalTokens).toBe(20200);
    expect(latest?.estimatedCost).toBeCloseTo(0.0089, 6);
    expect(latest?.approvalsCount).toBe(2);
    expect(latest?.approvalsStatus).toBe('approved');
    expect(latest?.risksCount).toBe(1);
    expect(latest?.artifactsCount).toBe(1);
    expect(latest?.handoffsCount).toBe(1);
    expect(latest?.durationMs).toBeGreaterThan(0);
    expect(loopState.current).toHaveLength(1);
    expect(loopState.historical).toHaveLength(0);
  });

  it('renders the served monitor shell as the Vite app', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-start-2',
        type: 'task.started',
        timestamp: '2026-06-14T10:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood-2',
        summary: 'Start dogfood live monitor cost accountability',
      },
      { baseDir },
    );

    recordModelUsage(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 10000,
        outputTokens: 1000,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-dogfood-2',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        timestamp: '2026-06-14T10:02:00.000Z',
      },
      { baseDir },
    );

    recordTokenCost(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 8000,
        outputTokens: 1200,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-dogfood-2',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        timestamp: '2026-06-14T10:03:00.000Z',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-complete-2',
        type: 'task.completed',
        timestamp: '2026-06-14T10:09:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood-2',
        summary: 'Monitor polish complete',
      },
      { baseDir },
    );

    const html = renderMonitorHtml({ baseDir });

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-monitor-ui="vite"');
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);
    expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/index-[^"]+\.css">/);
    expect((html.match(/id="latest-run"/g) ?? []).length).toBe(1);
    expect((html.match(/class="sl-sidebar"/g) ?? []).length).toBe(1);
    expect((html.match(/id="historical-ledger"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('sl-sticky-nav');
    expect(html).not.toContain('open class="historical-ledger"');
  });

  it('separates current run readiness from historical ledger readiness', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-current-start',
        type: 'task.started',
        timestamp: '2026-06-14T11:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-current',
        summary: 'Start current monitor work',
      },
      { baseDir },
    );

    recordModelUsage(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 4000,
        outputTokens: 500,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-current',
        project: 'Safeloop',
        taskId: 'current-monitor',
        taskName: 'Current monitor work',
        timestamp: '2026-06-14T11:01:00.000Z',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-historical-start',
        type: 'task.started',
        timestamp: '2026-06-13T08:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-history',
        summary: 'Older historical work',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-historical-risk',
        type: 'risk.detected',
        timestamp: '2026-06-13T08:01:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-history',
        summary: 'Historical risk',
        metadata: { severity: 'high' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-historical-complete',
        type: 'task.completed',
        timestamp: '2026-06-13T08:02:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-history',
        summary: 'Historical work complete',
      },
      { baseDir },
    );

    const payload = buildMonitorDashboardPayload(getDashboardSnapshot({ baseDir }));

    expect(payload.viewModel.current.latestRun).toBeTruthy();
    expect(payload.viewModel.current.currentLoops).toHaveLength(1);
    expect(payload.viewModel.historical.loops).toHaveLength(1);
    expect(payload.viewModel.current.currentReadiness.score).toBeGreaterThan(0);
    expect(payload.viewModel.historical.readiness.score).toBeLessThan(payload.viewModel.current.currentReadiness.score);
    expect(payload.viewModel.current.risks).toHaveLength(0);
    expect(payload.viewModel.historical.risks).toHaveLength(1);
  });

  it('records token/cost events and aggregates costs by agent, task, and project', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    const first = recordTokenCost(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 10000,
        outputTokens: 2000,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-1',
        project: 'Safeloop',
        taskId: 'task-monitor',
        taskName: 'Build the live monitor',
        timestamp: '2026-06-14T10:10:00.000Z',
      },
      { baseDir },
    );

    const second = recordTokenCost(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 5000,
        outputTokens: 500,
        agentId: 'opencode-1',
        caseId: 'case-2',
        project: 'PLOTS',
        taskId: 'task-dogfood',
        taskName: 'Run dogfood validation',
        timestamp: '2026-06-14T10:11:00.000Z',
      },
      { baseDir },
    );

    const tokenEvents = readTokenCosts({ baseDir });
    const summary = getCaseCostSummary(undefined, { baseDir });

    expect(first.totalTokens).toBe(12000);
    expect(second.totalTokens).toBe(5500);
    expect(tokenEvents).toHaveLength(2);
    expect(tokenEvents[0].agent).toBe('Hermes');
    expect(tokenEvents.map((event) => event.project)).toEqual(['Safeloop', 'PLOTS']);
    expect(summary.totalCost).toBeCloseTo(0.00875, 6);
    expect(summary.costByAgent['Hermes']).toBeCloseTo(0.0065, 6);
    expect(summary.costByAgent['opencode-1']).toBeCloseTo(0.00225, 6);
    expect(summary.costByTask['Build the live monitor']).toBeCloseTo(0.0065, 6);
    expect(summary.costByTask['Run dogfood validation']).toBeCloseTo(0.00225, 6);
    expect(summary.costByProject['Safeloop']).toBeCloseTo(0.0065, 6);
    expect(summary.costByProject['PLOTS']).toBeCloseTo(0.00225, 6);
    expect(summary.usageCount).toBe(2);
  });

  it('compares steering runs, detects drift, and scores readiness', () => {
    const previous = recordSteeringProfile(
      {
        steeringProfileId: 'steer-v1',
        promptVersion: '1.0.0',
        instructionVersion: '1.0.0',
        agent: 'Hermes',
        model: 'gpt-5-mini',
        tokens: 14500,
        cost: 1.45,
        decisions: 4,
        risks: 3,
        approvals: 1,
        testsPassed: 3,
        releaseReadiness: 74,
        caseId: 'case-1',
        timestamp: '2026-06-14T10:03:00.000Z',
      },
      { baseDir },
    );

    const current = recordSteeringProfile(
      {
        steeringProfileId: 'steer-v2',
        promptVersion: '1.1.0',
        instructionVersion: '1.1.0',
        agent: 'Hermes',
        model: 'gpt-5-mini',
        tokens: 11200,
        cost: 1.12,
        decisions: 6,
        risks: 1,
        approvals: 2,
        testsPassed: 5,
        releaseReadiness: 91,
        caseId: 'case-1',
        timestamp: '2026-06-14T10:04:00.000Z',
      },
      { baseDir },
    );

    const comparison = compareSteeringRuns(current, previous);
    const driftOnTrack = detectGoalDrift({
      originalGoal: 'Add a README badge',
      artifactsChanged: ['README.md'],
      decisionsMade: ['Update README badge'],
      risksAdded: [],
    });
    const driftPossible = detectGoalDrift({
      originalGoal: 'Add a README badge',
      artifactsChanged: ['README.md', 'package.json', 'build config'],
      decisionsMade: ['Update README badge'],
      risksAdded: ['Scope growth'],
    });
    const readiness = calculateReadinessScore({
      risks: [{ severity: 'medium', status: 'open' }],
      approvals: [{ status: 'approved' }],
      attachments: ['README.md', 'docs/LIVE_MONITOR.md'],
      evidence: ['case file', 'event stream'],
      handoffs: ['handoff manifest'],
      tests: { passed: true },
    });

    expect(previous.steeringProfileId).toBe('steer-v1');
    expect(current.steeringProfileId).toBe('steer-v2');
    expect(comparison.verdict).toBe('improved');
    expect(comparison.deltas.tokens).toBe(-3300);
    expect(comparison.deltas.cost).toBeCloseTo(-0.33, 6);
    expect(comparison.insights).toEqual(
      expect.arrayContaining([
        'Reduced token use',
        'Reduced risk count',
        'Improved release readiness',
      ]),
    );
    expect(driftOnTrack.status).toBe('on_track');
    expect(driftPossible.status).toBe('possible_drift');
    expect(readiness.score).toBe(92);
    expect(readiness.status).toBe('Ready with review');
    expect(readiness.blockers).toEqual(['1 medium risk remains open']);
    expect(readiness.recommendations).toEqual(
      expect.arrayContaining(['Resolve open risks before release']),
    );
  });

  it('returns a dashboard snapshot with active loops, cost, readiness, and steering intelligence', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-1',
        type: 'task.started',
        timestamp: '2026-06-14T11:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        participantId: 'Hermes',
        caseId: 'case-1',
        summary: 'Start the loop monitor demo',
        metadata: { goal: 'Monitor agent work' },
      },
      { baseDir },
    );

    recordModelUsage(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 8000,
        outputTokens: 1200,
        agentId: 'hermes-1',
        caseId: 'case-1',
        project: 'Safeloop',
        taskId: 'task-monitor-demo',
        taskName: 'Build the loop monitor demo',
        timestamp: '2026-06-14T11:01:00.000Z',
      },
      { baseDir },
    );

    recordSteeringProfile(
      {
        steeringProfileId: 'steer-v1',
        promptVersion: '1.0.0',
        instructionVersion: '1.0.0',
        agent: 'Hermes',
        model: 'gpt-5-mini',
        tokens: 9200,
        cost: 2.25,
        decisions: 4,
        risks: 2,
        approvals: 1,
        testsPassed: 2,
        releaseReadiness: 80,
        caseId: 'case-1',
        timestamp: '2026-06-14T11:02:00.000Z',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-2',
        type: 'risk.detected',
        timestamp: '2026-06-14T11:03:00.000Z',
        agentId: 'opencode-1',
        agentName: 'OpenCode',
        caseId: 'case-1',
        summary: 'Scope drift risk detected',
        metadata: { severity: 'medium' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-3',
        type: 'approval.requested',
        timestamp: '2026-06-14T11:04:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-1',
        summary: 'Request approval for release',
        metadata: { approver: 'Charles' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-4',
        type: 'artifact.changed',
        timestamp: '2026-06-14T11:05:00.000Z',
        agentId: 'opencode-1',
        agentName: 'OpenCode',
        caseId: 'case-1',
        summary: 'README changed',
        metadata: { path: 'README.md' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-5',
        type: 'handoff.created',
        timestamp: '2026-06-14T11:06:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-1',
        summary: 'Hand off to Charles',
        metadata: { from: 'Hermes', to: 'Charles' },
      },
      { baseDir },
    );

    const snapshot = getDashboardSnapshot({ baseDir });

    expect(snapshot.activeLoops).toHaveLength(1);
    expect(snapshot.activeLoops[0].agent).toBe('Hermes');
    expect(snapshot.activeLoops[0].currentModel).toBe('gpt-5-mini');
    expect(snapshot.events).toHaveLength(7);
    expect(snapshot.costSummary.totalCost).toBeGreaterThan(0);
    expect(snapshot.costSummary.costByAgent['hermes-1']).toBeGreaterThan(0);
    expect(snapshot.costSummary.costByTask['Build the loop monitor demo']).toBeGreaterThan(0);
    expect(snapshot.costSummary.costByProject['Safeloop']).toBeGreaterThan(0);
    expect(snapshot.risks).toHaveLength(1);
    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.handoffs).toHaveLength(1);
    expect(snapshot.readiness.score).toBeGreaterThan(0);
    expect(snapshot.readiness.status).toBe('Ready with review');
    expect(snapshot.steeringInsights).toHaveLength(1);
    expect(snapshot.steeringInsights[0].verdict).toBe('baseline');
    expect(snapshot.eventCount).toBe(7);
    expect(snapshot.lastUpdated).toBe('2026-06-14T11:06:00.000Z');
    expect(snapshot.monitoredPath).toBe(join(baseDir, '.safeloop'));

    const payload = buildMonitorDashboardPayload(snapshot);
    expect(payload).toEqual(expect.objectContaining({
      activeLoops: snapshot.activeLoops,
      events: snapshot.events,
      eventCount: snapshot.eventCount,
      monitoredPath: snapshot.monitoredPath,
      lastUpdated: snapshot.lastUpdated,
      costSummary: snapshot.costSummary,
      modelUsage: snapshot.modelUsage,
      risks: snapshot.risks,
      approvals: snapshot.approvals,
      artifacts: snapshot.artifacts,
      handoffs: snapshot.handoffs,
      readiness: snapshot.readiness,
      steeringInsights: snapshot.steeringInsights,
    }));
    expect(payload.viewModel).toEqual(expect.objectContaining({
      status: expect.any(Object),
      current: expect.any(Object),
      historical: expect.any(Object),
      spend: expect.any(Object),
      tokens: expect.any(Object),
      diagnostics: expect.any(Object),
    }));
  });

  it('summarizes a complete dogfood loop as a timecard', () => {
    setModelPricing(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        inputPerMillion: 0.25,
        outputPerMillion: 2.0,
        currency: 'USD',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-start',
        type: 'task.started',
        timestamp: '2026-06-14T10:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Dogfood live monitor cost accountability',
      },
      { baseDir },
    );

    recordModelUsage(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 10000,
        outputTokens: 1000,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-dogfood',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        timestamp: '2026-06-14T10:02:00.000Z',
      },
      { baseDir },
    );

    recordTokenCost(
      {
        provider: 'OpenAI',
        model: 'gpt-5-mini',
        modelArchitecture: 'hosted',
        inputTokens: 8000,
        outputTokens: 1200,
        agentId: 'hermes-1',
        agent: 'Hermes',
        caseId: 'case-dogfood',
        project: 'Safeloop',
        taskId: 'dogfood-live-monitor-cost-accountability',
        taskName: 'Dogfood live monitor cost accountability',
        timestamp: '2026-06-14T10:03:00.000Z',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-risk',
        type: 'risk.detected',
        timestamp: '2026-06-14T10:04:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Demo risk',
        metadata: { severity: 'medium' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-approval-requested',
        type: 'approval.requested',
        timestamp: '2026-06-14T10:05:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Request approval for dogfood',
        metadata: { approver: 'Charles' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-approval-resolved',
        type: 'approval.resolved',
        timestamp: '2026-06-14T10:06:00.000Z',
        agentId: 'charles-1',
        agentName: 'Charles',
        caseId: 'case-dogfood',
        summary: 'Approved dogfood loop',
        metadata: { decision: 'approved', approver: 'Charles' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-artifact',
        type: 'artifact.changed',
        timestamp: '2026-06-14T10:07:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Updated monitor UI',
        metadata: { path: 'src/monitor/server.ts' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-handoff',
        type: 'handoff.created',
        timestamp: '2026-06-14T10:08:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Handoff to Charles',
        metadata: { from: 'Hermes', to: 'Charles' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-completed',
        type: 'task.completed',
        timestamp: '2026-06-14T10:09:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Dogfood loop completed',
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-report',
        type: 'report.generated',
        timestamp: '2026-06-14T10:10:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-dogfood',
        summary: 'Report generated',
      },
      { baseDir },
    );

    const snapshot = getDashboardSnapshot({ baseDir });
    const summaries = summarizeLoopSummaries(snapshot);

    expect(summaries.latest?.taskName).toBe('Dogfood live monitor cost accountability');
    expect(summaries.latest?.agent).toBe('Hermes');
    expect(summaries.latest?.project).toBe('Safeloop');
    expect(summaries.latest?.status).toBe('completed');
    expect(summaries.latest?.eventCount).toBeGreaterThanOrEqual(8);
    expect(summaries.latest?.inputTokens).toBe(18000);
    expect(summaries.latest?.outputTokens).toBe(2200);
    expect(summaries.latest?.totalTokens).toBe(20200);
    expect(summaries.latest?.estimatedCost).toBeCloseTo(0.0089, 6);
    expect(summaries.latest?.approvalsCount).toBe(2);
    expect(summaries.latest?.approvalsStatus).toBe('approved');
    expect(summaries.latest?.risksCount).toBe(1);
    expect(summaries.latest?.artifactsCount).toBe(1);
    expect(summaries.latest?.handoffsCount).toBe(1);
    expect(summaries.latest?.durationMs).toBeGreaterThan(0);
    expect(summaries.current).toHaveLength(1);
    expect(summaries.historical).toHaveLength(0);
  });

  it('smokes the default served monitor shell', () => {
    const html = renderMonitorHtml();

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-monitor-ui="vite"');
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/);
    expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/index-[^"]+\.css">/);
    expect(html).toContain('id="app"');
  });

  it('marks resolved approvals as approved instead of leaving them pending', () => {
    appendEvent(
      {
        id: 'evt-1',
        type: 'task.started',
        timestamp: '2026-06-14T12:00:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-1',
        summary: 'Start approval flow',
        metadata: { goal: 'Exercise approval aggregation' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-2',
        type: 'approval.requested',
        timestamp: '2026-06-14T12:01:00.000Z',
        agentId: 'hermes-1',
        agentName: 'Hermes',
        caseId: 'case-1',
        summary: 'Request approval for README change',
        metadata: { approver: 'Charles', reason: 'Need review before commit' },
      },
      { baseDir },
    );

    appendEvent(
      {
        id: 'evt-3',
        type: 'approval.resolved',
        timestamp: '2026-06-14T12:02:00.000Z',
        agentId: 'charles-1',
        agentName: 'Charles',
        caseId: 'case-1',
        summary: 'Approved for local validation only',
        metadata: {
          approvalId: 'approval-1781475802831-zy1jj0',
          decision: 'approved',
          approver: 'Charles',
        },
      },
      { baseDir },
    );

    const snapshot = getDashboardSnapshot({ baseDir });

    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.approvals[0]).toMatchObject({
      summary: 'Request approval for README change',
      approver: 'Charles',
      reason: 'Need review before commit',
      status: 'approved',
    });
  });

  it('starts on a custom port and fails gracefully when the port is already in use', async () => {
    const blocker = createServer();
    const blockerPort = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        const address = blocker.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    const customServer = await startMonitorServer({ baseDir, port: blockerPort + 1 });
    expect(customServer.port).toBe(blockerPort + 1);
    await customServer.close();

    await expect(startMonitorServer({ baseDir, port: blockerPort })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });

    blocker.close();
  });
});
