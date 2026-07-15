import * as http from 'http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startMonitorServer } from '../src/monitor/server';

function httpGet(url: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

jest.setTimeout(30000);

describe('GET /api/timecards/export', () => {
  let serverHandle: { port: number; close: () => Promise<void> } | null = null;
  let baseDir = '';
  const port = 38891;

  beforeAll(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'safeloop-export-'));
    const safeloopDir = join(baseDir, '.safeloop');
    mkdirSync(safeloopDir, { recursive: true });
    serverHandle = await startMonitorServer({ port, baseDir });
  });

  afterAll(async () => {
    if (serverHandle) await serverHandle.close();
  });

  test('export endpoint exists and returns JSON', async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    expect(statusCode).toBe(200);
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  test('export response contains expected top-level fields', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    expect(body.generatedAt).toBeDefined();
    expect(typeof body.generatedAt).toBe('string');
    expect(body).toHaveProperty('deployment');
    expect(body).toHaveProperty('currentSessionId');
    expect(body).toHaveProperty('isHistoricalOnly');
    expect(body).toHaveProperty('timecardSummary');
  });

  test('export response includes current and historical timecard arrays', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    const tc = body.timecardSummary;
    expect(Array.isArray(tc.current)).toBe(true);
    expect(Array.isArray(tc.historical)).toBe(true);
    expect(tc.totals).toBeDefined();
    expect(typeof tc.totals.currentCount).toBe('number');
    expect(typeof tc.totals.historicalCount).toBe('number');
    expect(typeof tc.totals.billableCandidateCount).toBe('number');
    expect(typeof tc.totals.totalDurationMs).toBe('number');
    expect(typeof tc.totals.totalTokens).toBe('number');
    expect(typeof tc.totals.totalEstimatedCost).toBe('number');
    expect(typeof tc.totals.pricingAvailable).toBe('boolean');
  });

  test('empty/no-timecard state returns valid export JSON', async () => {
    // baseDir has no events, so export should be valid but empty
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    expect(statusCode).toBe(200);
    expect(body.timecardSummary.current).toEqual([]);
    expect(body.timecardSummary.historical).toEqual([]);
    expect(body.timecardSummary.totals.billableCandidateCount).toBe(0);
    expect(body.timecardSummary.totals.totalTokens).toBe(0);
    expect(body.isHistoricalOnly).toBe(false);
  });

  test('existing dashboard endpoint still works', async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${port}/api/dashboard`);
    expect(statusCode).toBe(200);
    expect(body).toHaveProperty('viewModel');
    expect(body).toHaveProperty('oversight');
  });
});

describe('GET /api/timecards/export with fixture data', () => {
  let serverHandle: { port: number; close: () => Promise<void> } | null = null;
  let baseDir = '';
  const port = 38892;

  beforeAll(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'safeloop-export-fixture-'));
    const safeloopDir = join(baseDir, '.safeloop');
    mkdirSync(safeloopDir, { recursive: true });

    const now = Date.now();
    const events = [
      { id: 'e1', type: 'task.started', timestamp: new Date(now - 30000).toISOString(), sessionId: 'run-export', caseId: 'case-export', agentId: 'hermes', agentName: 'Hermes', summary: 'planning' },
      { id: 'h1', type: 'handoff.created', timestamp: new Date(now - 25000).toISOString(), sessionId: 'run-export', caseId: 'case-export', agentId: 'hermes', agentName: 'Hermes', summary: 'Hermes->OpenCode', metadata: { from: 'Hermes', to: 'OpenCode' } },
      { id: 'tc1', type: 'token.cost', timestamp: new Date(now - 20000).toISOString(), sessionId: 'run-export', caseId: 'case-export', agentId: 'opencode', agentName: 'OpenCode', summary: 'Token cost recorded for gpt-4', metadata: { provider: 'openai', model: 'gpt-4', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, estimatedCost: 0.04, pricingAvailable: true, agentId: 'opencode', agent: 'OpenCode', caseId: 'case-export', sessionId: 'run-export', taskName: 'code gen' } },
      { id: 'e2', type: 'task.completed', timestamp: new Date(now - 5000).toISOString(), sessionId: 'run-export', caseId: 'case-export', agentId: 'hermes', agentName: 'Hermes', summary: 'done' },
    ];

    writeFileSync(join(safeloopDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    serverHandle = await startMonitorServer({ port, baseDir });
  });

  afterAll(async () => {
    if (serverHandle) await serverHandle.close();
  });

  test('export with events includes populated timecards and correct session state', async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    expect(statusCode).toBe(200);
    expect(body.generatedAt).toBeDefined();
    expect(body.currentSessionId).toBe('run-export');
    expect(body.isHistoricalOnly).toBe(false);

    const tc = body.timecardSummary;
    expect(tc.current.length).toBeGreaterThanOrEqual(1);
    expect(tc.totals.totalTokens).toBeGreaterThanOrEqual(1200);

    // verify a timecard has expected fields
    const card = tc.current[0];
    expect(card.id).toBeDefined();
    expect(typeof card.billableCandidate).toBe('boolean');
    expect(typeof card.totalTokens).toBe('number');
    expect(typeof card.pricingAvailable).toBe('boolean');
    expect(typeof card.handoffCount).toBe('number');
  });

  test('deployment metadata is included in export', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${port}/api/timecards/export`);
    expect(body.deployment).toBeDefined();
    expect(body.deployment.mode).toBe('local');
    expect(body.deployment.transport).toBe('polling');
  });
});
