import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { getDashboardSnapshot } from '../src/monitor/dashboardData';
import { buildMonitorViewModel } from '../src/monitor/viewModel';

function nowSecondsFloat(offsetSec = 0) {
  return (Date.now() / 1000) + offsetSec;
}

describe('external JSONL event ingestion (CrewAI shape)', () => {
  test('CrewAI run.started and run.completed are normalized and visible in snapshot', () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'safeloop-ext-'));
    const externalPath = resolve(tmp, 'external.events.jsonl');

    const tsStart = nowSecondsFloat(-5);
    const tsEnd = nowSecondsFloat(0);

    const runStarted = {
      id: 'ext-run-1',
      runId: 'run-1',
      timestamp: tsStart,
      type: 'run.started',
      agent: null,
      task: null,
      data: {
        framework: 'crewai',
        experiment: 'dimension_coding',
        mode: 'run',
      },
    };

    const runCompleted = {
      id: 'ext-run-1-complete',
      runId: 'run-1',
      timestamp: tsEnd,
      type: 'run.completed',
      agent: null,
      task: null,
      data: {
        framework: 'crewai',
        experiment: 'dimension_coding',
        mode: 'run',
        result: 'ok',
      },
    };

    writeFileSync(externalPath, JSON.stringify(runStarted) + '\n' + JSON.stringify(runCompleted) + '\n', 'utf8');

    const snapshot = getDashboardSnapshot({ externalEventPaths: [externalPath] });

    try {
      const evStart = snapshot.events.find((e) => e.id === 'ext-run-1');
      const evComplete = snapshot.events.find((e) => e.id === 'ext-run-1-complete');
      expect(evStart).toBeDefined();
      expect(evComplete).toBeDefined();

      // timestamps normalized to ISO strings
      expect(typeof evStart!.timestamp).toBe('string');
      expect(!Number.isNaN(Date.parse(evStart!.timestamp))).toBeTruthy();
      expect(typeof evComplete!.timestamp).toBe('string');
      expect(!Number.isNaN(Date.parse(evComplete!.timestamp))).toBeTruthy();

      // completed event agentName should reflect framework -> CrewAI
      expect(evComplete!.agentName).toBe('CrewAI');

      // metadata.source checks
      expect(evComplete!.metadata).toBeDefined();
      const src = (evComplete!.metadata as any).source;
      expect(src).toBeDefined();
      expect(src.kind).toBe('external-jsonl');
      expect(src.framework).toBe('crewai');
      expect(src.raw).toBeDefined();

      // view model creation should not throw
      expect(() => buildMonitorViewModel(snapshot as any)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
