import * as http from 'http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startMonitorServer } from '../src/monitor/server';

const MONITOR_PATH = '/api/dashboard';

function waitForDashboard(url: string, timeout = 60000): Promise<any> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, (res) => {
        const { statusCode } = res;
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (statusCode && statusCode >= 200 && statusCode < 300) {
            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (err) {
              reject(err);
            }
            return;
          }
          if (Date.now() - start > timeout) return reject(new Error('timeout waiting for /api/dashboard'));
          setTimeout(attempt, 500);
        });
      }).on('error', () => {
        if (Date.now() - start > timeout) return reject(new Error('timeout waiting for /api/dashboard'));
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

jest.setTimeout(120000);

describe('Dashboard /api/dashboard integration (deterministic fixtures)', () => {
  let serverHandle: { port: number; close: () => Promise<void> } | null = null;
  let baseDir = '';
  const port = 38888; // test port

  beforeAll(async () => {
    // create temp base dir and write .safeloop/events.jsonl from fixtures
    baseDir = mkdtempSync(join(tmpdir(), 'safeloop-test-'));
    const safeloopDir = join(baseDir, '.safeloop');
    mkdirSync(safeloopDir, { recursive: true });

    const healthyRaw = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'oversight-healthy-loop.jsonl'), 'utf8');
    const problematicRaw = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'oversight-problematic-loop.jsonl'), 'utf8');

    // timestamping strategy:
    // - problematic events put ~90 minutes ago (stale window)
    // - healthy events put ~30 seconds ago so they are the latest
    const nowMs = Date.now();
    const staleOffsetMs = 90 * 60 * 1000; // 90 minutes
    const baseProblemTs = new Date(nowMs - staleOffsetMs);
    const baseHealthyTs = new Date(nowMs - 30 * 1000); // 30s ago

    const problematicLines = problematicRaw
      .split(/\r?\n/)
      .map((line) => (line.trim() ? JSON.parse(line) : null))
      .filter(Boolean)
      .map((obj: any, idx: number) => {
        const ts = new Date(baseProblemTs.getTime() + idx * 1000).toISOString();
        obj.timestamp = ts;
        return JSON.stringify(obj);
      });

    const healthyLines = healthyRaw
      .split(/\r?\n/)
      .map((line) => (line.trim() ? JSON.parse(line) : null))
      .filter(Boolean)
      .map((obj: any, idx: number) => {
        const ts = new Date(baseHealthyTs.getTime() + idx * 1000).toISOString();
        obj.timestamp = ts;
        return JSON.stringify(obj);
      });

    // healthy first so latestLoop is healthy
    writeFileSync(join(safeloopDir, 'events.jsonl'), `${healthyLines.join('\n')}\n${problematicLines.join('\n')}\n`, 'utf8');

    // start monitor server programmatically with baseDir
    serverHandle = await startMonitorServer({ port, baseDir });
    const url = `http://127.0.0.1:${serverHandle.port}${MONITOR_PATH}`;
    await waitForDashboard(url, 60000);
  });

  afterAll(async () => {
    if (serverHandle) {
      await serverHandle.close();
    }
  });

  test('exposes oversight keys and enforces completed-loop invariant (strict)', async () => {
    if (!serverHandle) throw new Error('server not started');
    const url = `http://127.0.0.1:${serverHandle.port}${MONITOR_PATH}`;
    const json = await waitForDashboard(url, 60000);
    expect(json).toBeDefined();
    expect(json.oversight).toBeDefined();

    const oversight = json.oversight;
    // Required top-level oversight keys
    expect(oversight.summary).toBeDefined();
    expect(oversight.latestLoop).toBeDefined();
    expect(Array.isArray(oversight.loopTimecards)).toBe(true);
    expect(oversight.warnings).toBeDefined();
    expect(oversight.anomalies).toBeDefined();
    expect(oversight.explainability).toBeDefined();
    expect(oversight.feedback).toBeDefined();

    // Backward compatibility keys
    const keys = [
      'activeLoops',
      'events',
      'eventCount',
      'monitoredPath',
      'lastUpdated',
      'costSummary',
      'modelUsage',
      'risks',
      'approvals',
      'artifacts',
      'handoffs',
      'readiness',
      'steeringInsights',
    ];
    for (const k of keys) {
      expect(json[k] !== undefined).toBe(true);
    }

    // Strict: healthy completed loop invariant
    const latest = oversight.latestLoop;
    expect(latest.status).toBe('completed');
    const staleWarning = (latest.warnings || []).find((w: any) => w.code === 'stale_loop');
    expect(staleWarning).toBeUndefined();
    expect(latest.recommendedAction).not.toBe('investigate_stale_loop');

    // Problematic loop checks - deterministic
    const problematic = (oversight.loopTimecards || []).find((l: any) => l.caseId === 'case-problem');
    expect(problematic).toBeDefined();
    expect(['needs_review', 'critical']).toContain(problematic.oversightLevel);
    // unresolved approval
    expect(problematic.approvalsStatus === 'pending' || (problematic.anomalies || []).some((a: any) => a.code === 'unresolved_approval')).toBeTruthy();
    // missing attribution (fixture lacks project/taskName on model usage)
    expect((problematic.anomalies || []).some((a: any) => a.code === 'missing_attribution')).toBeTruthy();
    // stale warning should exist for old incomplete loop
    expect((problematic.warnings || []).some((w: any) => w.code === 'stale_loop')).toBeTruthy();
    // missing explainability
    expect((problematic.warnings || []).some((w: any) => w.code === 'missing_explanation')).toBeTruthy();
    // explainability coverage calculated
    expect(oversight.explainability).toBeDefined();
    // feedback summary calculated (healthy has feedback)
    expect(oversight.feedback).toBeDefined();
    expect(oversight.feedback.feedbackCount).toBeGreaterThanOrEqual(1);
  });
});
