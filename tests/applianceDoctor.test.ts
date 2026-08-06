import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { sealLedger } from '../src/ledgerIntegrity';
import { runApplianceDoctor } from '../src/applianceDoctor';
import { initializeSafeloopPolicyConfig } from '../src/policyConfig';

function makeBaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-appliance-'));
}

describe('appliance doctor', () => {
  test('fails when compiled policy is missing', () => {
    const baseDir = makeBaseDir();
    const result = runApplianceDoctor({ baseDir, includeMcp: false });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'policy readiness', status: 'fail' }),
    ]));
  });

  test('passes k12 policy checks and warns for unsealed ledger', () => {
    const baseDir = makeBaseDir();
    initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });

    const result = runApplianceDoctor({ baseDir, includeMcp: false });

    expect(result.profile).toBe('k12-offline-rag');
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'policy readiness', status: 'pass' }),
      expect.objectContaining({ name: 'k12 offline controls', status: 'pass' }),
      expect.objectContaining({ name: 'ledger seal', status: 'warn' }),
    ]));
  });

  test('reports a verified ledger seal when present', () => {
    const baseDir = makeBaseDir();
    initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });
    appendEvent({
      id: 'evt-1',
      type: 'task.started',
      agentId: 'agent',
      summary: 'Start local RAG review',
    }, { baseDir });
    sealLedger({ baseDir });

    const result = runApplianceDoctor({ baseDir, includeMcp: false });

    expect(result.ok).toBe(true);
    expect(result.ledger.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ledger seal', status: 'pass' }),
    ]));
  });
});
