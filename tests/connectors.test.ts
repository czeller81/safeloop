import { createGenericCliConnector } from '../src/connectors/genericCliConnector';
import { createHermesConnector } from '../src/connectors/hermesConnector';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeFakeHermesHome(opts?: { patchPresent?: boolean }): string {
  const home = mkdtempSync(join(tmpdir(), 'safeloop-hermes-'));
  const hermesDir = join(home, '.hermes', 'hermes-agent', 'apps', 'desktop', 'electron');
  mkdirSync(hermesDir, { recursive: true });

  let content = '// bootstrap-runner.cjs\nfunction spawnPowerShell(cmd) { /* original */ }\n';
  if (opts?.patchPresent) {
    content += '// SAFELOOP_HERMES_POWERSHELL_GUARD patched\nconst SAFELOOP_HERMES_POWERSHELL_GUARD = true;\n';
  }
  writeFileSync(join(hermesDir, 'bootstrap-runner.cjs'), content, 'utf8');
  return home;
}

describe('connectors', () => {
  describe('Generic CLI connector', () => {
    test('returns execute-wrapper mode and instructions', () => {
      const connector = createGenericCliConnector();
      const detect = connector.detect();
      const status = connector.status();
      const verify = connector.verify();

      expect(detect.found).toBe(true);
      expect(detect.path).toBeDefined();
      expect(detect.notes.some(n => n.includes('safeloop-command.ts'))).toBe(true);
      expect(detect.notes.some(n => n.includes('--check-only'))).toBe(true);

      expect(status.connected).toBe(true);
      expect(status.mode).toBe('execute-wrapper');
      expect(status.notes.some(n => n.includes('Exit codes'))).toBe(true);

      expect(verify.ok).toBe(true);
      expect(verify.checks.length).toBeGreaterThanOrEqual(3);
      expect(verify.checks.some(c => c.name.includes('Honest boundary'))).toBe(true);
    });
  });

  describe('Hermes connector', () => {
    test('reports not found cleanly when path missing', () => {
      const fakeHome = mkdtempSync(join(tmpdir(), 'safeloop-noherm-'));
      const connector = createHermesConnector({ homeDir: fakeHome });
      const detect = connector.detect();
      const status = connector.status();

      expect(detect.found).toBe(false);
      expect(detect.path).toBeUndefined();
      expect(detect.notes.some(n => n.includes('NOT found'))).toBe(true);

      expect(status.connected).toBe(false);
      expect(status.mode).toBe('unknown');
    });

    test('detects fake bootstrap-runner.cjs in temp home', () => {
      const fakeHome = makeFakeHermesHome();
      const connector = createHermesConnector({ homeDir: fakeHome });
      const detect = connector.detect();

      expect(detect.found).toBe(true);
      expect(detect.path).toBeDefined();
      expect(detect.path).toContain('bootstrap-runner.cjs');
      expect(detect.notes.some(n => n.includes('bootstrap-runner found'))).toBe(true);
    });

    test('identifies preflight patch text when present', () => {
      const fakeHome = makeFakeHermesHome({ patchPresent: true });
      const connector = createHermesConnector({ homeDir: fakeHome });
      const status = connector.status();
      const verify = connector.verify();

      expect(status.connected).toBe(true);
      expect(status.mode).toBe('preflight');
      expect(status.notes.some(n => n.includes('preflight patch detected'))).toBe(true);

      const patchCheck = verify.checks.find(c => c.name.includes('patch marker'));
      expect(patchCheck).toBeDefined();
      expect(patchCheck!.ok).toBe(true);
    });

    test('connector status includes honest boundary notes', () => {
      const fakeHome = makeFakeHermesHome();
      const connector = createHermesConnector({ homeDir: fakeHome });
      const status = connector.status();
      const verify = connector.verify();

      // Not patched → observer mode with boundary note
      expect(status.mode).toBe('observer');
      expect(status.notes.some(n => n.includes('Honest boundary') || n.includes('spawnPowerShell'))).toBe(true);

      const boundaryCheck = verify.checks.find(c => c.name.includes('Honest boundary'));
      expect(boundaryCheck).toBeDefined();
      expect(boundaryCheck!.ok).toBe(true);
      expect(boundaryCheck!.message).toContain('spawnPowerShell');
    });
  });
});
