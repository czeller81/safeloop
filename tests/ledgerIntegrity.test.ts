import { appendFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { sealLedger, verifyLedger } from '../src/ledgerIntegrity';

describe('ledger integrity seal and verify', () => {
  test('seals and verifies an existing event ledger without changing event schema', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-ledger-'));
    appendEvent({
      id: 'evt-1',
      type: 'task.started',
      agentId: 'agent',
      caseId: 'case',
      summary: 'start',
    }, { baseDir });
    appendEvent({
      id: 'evt-2',
      type: 'task.completed',
      agentId: 'agent',
      caseId: 'case',
      summary: 'done',
    }, { baseDir });

    const seal = sealLedger({ baseDir });
    const verified = verifyLedger({ baseDir });

    expect(seal.eventCount).toBe(2);
    expect(verified.ok).toBe(true);
    expect(verified.sealed).toBe(true);
    expect(verified.expectedRootHash).toBe(verified.actualRootHash);
  });

  test('detects ledger edits after sealing', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-ledger-'));
    appendEvent({
      id: 'evt-1',
      type: 'task.started',
      agentId: 'agent',
      caseId: 'case',
      summary: 'start',
    }, { baseDir });
    sealLedger({ baseDir });

    appendEvent({
      id: 'evt-2',
      type: 'task.completed',
      agentId: 'agent',
      caseId: 'case',
      summary: 'tampered after seal',
    }, { baseDir });

    const result = verifyLedger({ baseDir });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not match');
    expect(result.expectedEventCount).toBe(1);
    expect(result.actualEventCount).toBe(2);
  });

  test('reports malformed lines without hashing them into valid event chain', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-ledger-'));
    const eventPath = join(baseDir, '.safeloop', 'events.jsonl');
    appendEvent({
      id: 'evt-1',
      type: 'task.started',
      agentId: 'agent',
      caseId: 'case',
      summary: 'start',
    }, { baseDir });
    appendFileSync(eventPath, '{ malformed line\n', 'utf8');

    const seal = sealLedger({ baseDir });
    const result = verifyLedger({ baseDir });

    expect(seal.eventCount).toBe(1);
    expect(seal.malformedLineCount).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.malformedLineCount).toBe(1);
  });
});
