import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync, rmSync, readFileSync } from 'fs';
import { getDashboardSnapshot, buildMonitorViewModel } from '../src/monitor';

describe('dogfood writer idempotence and monitor visibility', () => {
  const projectRoot = process.cwd();
  const dogfoodDir = resolve(projectRoot, '.safeloop-dogfood', '.safeloop');
  const eventsPath = resolve(dogfoodDir, 'events.jsonl');

  beforeAll(() => {
    // remove any existing dogfood ledger
    if (existsSync(eventsPath)) {
      try { rmSync(eventsPath); } catch (e) { /* ignore */ }
    }
    if (existsSync(dogfoodDir)) {
      try { rmSync(dogfoodDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  });

  it('produces a single clean ledger and monitor shows reasonable duration and fields', () => {
    // run the dogfood writer twice
    execSync('npm run dogfood:handoff', { stdio: 'inherit' });
    execSync('npm run dogfood:handoff', { stdio: 'inherit' });

    // events file should exist and contain exactly one scenario (~10 events)
    expect(existsSync(eventsPath)).toBe(true);
    const lines = readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.length).toBeLessThanOrEqual(20);

    // load monitor snapshot and view model
    const snapshot = getDashboardSnapshot({ baseDir: resolve(projectRoot, '.safeloop-dogfood') });
    const view = buildMonitorViewModel(snapshot);

    const found = view.oversight.loopTimecards.find((l: any) => l.caseId === 'case-dogfood-001' || l.taskName === 'Feed the dog daily at 8am');
    expect(found).toBeDefined();
    if (!found) return;
    const f: any = found;

    expect(f.handoffsCount).toBeGreaterThanOrEqual(1);
    expect(f.artifactsCount).toBeGreaterThanOrEqual(1);
    expect(f.approvalsStatus).toBe('approved');
    expect(f.status).toBe('completed');
    expect(f.anomalies && f.anomalies.find((a: any) => a.code === 'missing_attribution')).toBeUndefined();

    // duration should be small (under 1 minute)
    expect(f.durationMs).toBeLessThan(60_000);
  }, 120000);
});
