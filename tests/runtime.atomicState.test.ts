import { spawn } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAtomicClaimStore } from '../src/runtime/atomicStateStore';
import { runtimeStateDirectory } from '../src/runtime/runtimeSecret';

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-claims-'));
});

afterEach(() => {
  try {
    chmodSync(join(baseDir, 'runtime'), 0o700);
  } catch {
    // Only relevant to the permission-failure test.
  }
  rmSync(baseDir, { recursive: true, force: true });
});

describe('atomic claim store', () => {
  it('grants a first claim and refuses the second', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    expect(store.claim('id-1').granted).toBe(true);
    const second = store.claim('id-1');
    expect(second.granted).toBe(false);
    expect(second.conflict).toBe('consumed');
  });

  it('refuses to consume a revoked id', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    expect(store.revoke('id-1', 'operator withdrew').granted).toBe(true);
    const claim = store.claim('id-1');
    expect(claim.granted).toBe(false);
    expect(claim.conflict).toBe('revoked');
  });

  it('isolates namespaces so an approval id cannot spend a permit id', () => {
    const approvals = createAtomicClaimStore('approvals', { baseDir });
    const permits = createAtomicClaimStore('permits', { baseDir });
    expect(approvals.claim('shared-id').granted).toBe(true);
    expect(permits.claim('shared-id').granted).toBe(true);
  });

  it('accepts ids containing path separators without escaping its directory', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    expect(store.claim('../../etc/passwd').granted).toBe(true);
    const files = readdirSync(join(runtimeStateDirectory({ baseDir }), 'claims', 'test'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('lets an expired claim be reclaimed but not an unexpired one', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    expect(store.claim('id-1', { expires_at: new Date(Date.now() - 1000).toISOString() }).granted).toBe(true);
    expect(store.isClaimed('id-1')).toBe(false);
    expect(store.claim('id-1').granted).toBe(true);
    expect(store.claim('id-1').granted).toBe(false);
  });

  it('prunes expired records and keeps live ones', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    store.claim('old', { expires_at: new Date(Date.now() - 1000).toISOString() });
    store.claim('live', { expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(store.prune()).toBe(1);
    expect(store.count()).toBe(1);
  });
});

describe('corruption fail-safe', () => {
  it('treats an unreadable claim record as an active claim', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    store.claim('id-1');
    const directory = join(runtimeStateDirectory({ baseDir }), 'claims', 'test');
    const file = readdirSync(directory)[0];
    writeFileSync(join(directory, file), '{ this is not json');

    expect(store.isClaimed('id-1')).toBe(true);
    expect(store.claim('id-1').granted).toBe(false);
  });

  it('retains corrupt records during prune rather than freeing them for replay', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    store.claim('id-1');
    const directory = join(runtimeStateDirectory({ baseDir }), 'claims', 'test');
    writeFileSync(join(directory, readdirSync(directory)[0]), 'corrupt');
    expect(store.prune()).toBe(0);
    expect(store.claim('id-1').granted).toBe(false);
  });

  it('fails closed when the claim directory cannot be written', () => {
    const store = createAtomicClaimStore('test', { baseDir });
    store.claim('warmup');

    // Root ignores mode bits, so this assertion is only meaningful unprivileged.
    if (process.getuid && process.getuid() === 0) return;

    const claimDir = join(runtimeStateDirectory({ baseDir }), 'claims', 'test');
    chmodSync(claimDir, 0o500);
    try {
      const result = store.claim('id-after-lockdown');
      expect(result.granted).toBe(false);
      expect(result.conflict).toBe('io_error');
    } finally {
      chmodSync(claimDir, 0o700);
    }
  });
});

/**
 * Cross-process atomicity is the property that actually matters: SafeLoop
 * adapters are separate OS processes, so a single-process test would prove
 * nothing about double-spend. The racers are compiled from the real source
 * (not a reimplementation, and not build output the test cannot guarantee
 * exists) and started in parallel so they genuinely contend.
 */
describe('cross-process atomicity', () => {
  function compileRuntimeModules(destination: string): string {
    const ts = require('typescript') as typeof import('typescript');
    mkdirSync(join(destination, 'runtime'), { recursive: true });
    const sources: Array<[string, string]> = [
      [join('src', 'localStorage.ts'), join('localStorage.js')],
      [join('src', 'runtime', 'runtimeSecret.ts'), join('runtime', 'runtimeSecret.js')],
      [join('src', 'runtime', 'atomicStateStore.ts'), join('runtime', 'atomicStateStore.js')],
    ];
    for (const [from, to] of sources) {
      const code = readFileSync(join(__dirname, '..', from), 'utf8');
      const output = ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      writeFileSync(join(destination, to), output);
    }
    return join(destination, 'runtime', 'atomicStateStore.js');
  }

  it('yields exactly one winner when 24 OS processes race for the same id', async () => {
    const compiled = join(baseDir, 'compiled');
    const modulePath = compileRuntimeModules(compiled);

    const racer = join(baseDir, 'racer.js');
    writeFileSync(racer, `
      const { createAtomicClaimStore } = require(${JSON.stringify(modulePath)});
      const store = createAtomicClaimStore('race', { baseDir: process.argv[2] });
      process.stdout.write(store.claim(process.argv[3]).granted ? 'WON' : 'LOST');
    `);

    // Spawn all 24 first, then await: they contend for the same claim file.
    const workers = Array.from({ length: 24 }, () =>
      new Promise<string>((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [racer, baseDir, 'contested-permit'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output += String(chunk); });
        child.on('error', rejectPromise);
        child.on('close', () => resolvePromise(output.trim()));
      }));

    const outcomes = await Promise.all(workers);
    expect(outcomes.filter((outcome) => outcome === 'WON')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'LOST')).toHaveLength(23);
  }, 60_000);
});
