import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createGovernedMemoryAdapter, createInMemoryPersistenceAdapter, type CandidateMemory } from '../src';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-memory-adapter-'));
}

function candidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    memory_id: 'mem-1',
    memory_type: 'lesson',
    source_task: 'task-1',
    agent: 'agent-1',
    situation: 'A task completed successfully.',
    action: 'retry transient error',
    outcome: 'completed',
    lesson: 'Retry once after transient failures.',
    confidence: 0.9,
    evidence: ['artifact-1'],
    reuse_conditions: ['same service'],
    tenant: 'tenant-alpha',
    ...overrides,
  };
}

describe('governed memory adapter', () => {
  test('persists allowed candidate memory only after SafeLoop verification', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    const decision = adapter.write(candidate());
    expect(decision.allowed).toBe(true);
    expect(adapter.list()).toHaveLength(1);
  });

  test('reject decisions do not enter reference persistence adapter', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    const decision = adapter.write(candidate({ situation: '', lesson: '' }));
    expect(decision.decision).toBe('REJECT');
    expect(adapter.list()).toHaveLength(0);
  });

  test('quarantine decisions do not enter reference persistence adapter', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    const decision = adapter.write(candidate({ do_not_generalize: true }));
    expect(decision.decision).toBe('QUARANTINE');
    expect(adapter.list()).toHaveLength(0);
  });

  test('require-review decisions do not enter reference persistence adapter', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    const decision = adapter.write(candidate({ evidence: [] }));
    expect(decision.decision).toBe('REQUIRE_REVIEW');
    expect(adapter.list()).toHaveLength(0);
    expect(adapter.listReviewQueue()).toHaveLength(1);
  });

  test('allow-with-ttl persists active memory until ttl expires', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    const decision = adapter.write(candidate({ ttl: new Date(Date.now() + 60_000).toISOString() }), {
      scenario: {
        scenarioId: 'ttl',
        memoryWritePolicy: 'allow_with_ttl',
      },
    });
    expect(decision.decision).toBe('ALLOW_WITH_TTL');
    expect(adapter.listActive()).toHaveLength(1);

    adapter.write(candidate({ memory_id: 'expired', ttl: new Date(Date.now() - 1000).toISOString() }), {
      scenario: {
        scenarioId: 'ttl-expired',
        memoryWritePolicy: 'allow_with_ttl',
      },
    });
    expect(adapter.listActive().some((record) => record.memory_id === 'expired')).toBe(false);
  });

  test('duplicate allowed candidate uses merge semantics', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    expect(adapter.write(candidate()).decision).toBe('ALLOW');
    const merged = adapter.write(candidate({ lesson: 'Updated lesson.' }));
    expect(merged.decision).toBe('MERGE');
    expect(adapter.listActive()).toHaveLength(1);
    expect(adapter.listActive()[0].lesson).toBe('Updated lesson.');
  });

  test('quarantined memory is separate from active memory', () => {
    const persistence = createInMemoryPersistenceAdapter();
    const adapter = createGovernedMemoryAdapter(persistence, { baseDir: makeTempDir() });

    adapter.write(candidate({ confidence: 0.1 }));
    expect(adapter.listActive()).toHaveLength(0);
    expect(adapter.listQuarantine()).toHaveLength(1);
  });
});
