import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runK12LocalRagDemo } from '../examples/k12-local-rag-demo';
import { readEvents } from '../src/eventStream';

describe('K-12 local RAG demo', () => {
  test('writes isolated demo events, policy, seal, and audit export', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-k12-demo-'));

    const result = runK12LocalRagDemo(baseDir);
    const events = readEvents({ baseDir });

    expect(result.policyProfile).toBe('k12-offline-rag');
    expect(result.eventCount).toBe(9);
    expect(result.ledgerSealed).toBe(true);
    expect(result.applianceOk).toBe(true);
    expect(existsSync(result.auditExportPath)).toBe(true);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'task.started',
      'artifact.changed',
      'decision.made',
      'approval.requested',
      'approval.resolved',
      'risk.detected',
      'token.cost',
      'task.completed',
    ]));
  });
});
