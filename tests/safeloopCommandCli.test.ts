import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { readEvents } from '../src/eventStream';

function makeTempBaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-cli-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

const CLI_PATH = resolve(__dirname, '..', 'examples', 'safeloop-command.ts');

function runCli(args: string, baseDir: string): { stdout: string; exitCode: number; json: any } {
  try {
    const stdout = execSync(
      `node -r ts-node/register "${CLI_PATH}" ${args} --base-dir "${baseDir}"`,
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '' } },
    ).trim();
    let json: any = {};
    try { json = JSON.parse(stdout); } catch { json = { raw: stdout }; }
    return { stdout, exitCode: 0, json };
  } catch (err: any) {
    const stdout = (err.stdout ?? '').toString().trim();
    let json: any = {};
    try { json = JSON.parse(stdout); } catch { json = { raw: stdout }; }
    return { stdout, exitCode: err.status ?? 1, json };
  }
}

describe('safeloop-command CLI wrapper', () => {
  test('--check-only safe command returns allow and does not execute', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--check-only --command "node -e \\\"console.log(\\\'check-only-safe\\\')\\\""  --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.executed).toBe(false);
    expect(json.checkOnly).toBe(true);
    expect(json.eventId).toBeDefined();
  });

  test('--check-only dangerous command returns deny and does not execute', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--check-only --command "rm -rf ." --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(10);
    expect(json.decision).toBe('deny');
    expect(json.executed).toBe(false);
    expect(json.checkOnly).toBe(true);
    expect(json.eventId).toBeDefined();
    expect(json.violations).toBeDefined();
    expect(json.reasons).toBeDefined();
  });

  test('--check-only approval command returns requires_approval and does not execute', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--check-only --command "git push origin master" --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(20);
    expect(json.decision).toBe('requires_approval');
    expect(json.executed).toBe(false);
    expect(json.checkOnly).toBe(true);
    expect(json.eventId).toBeDefined();
    expect(json.reasons).toBeDefined();
  });

  test('--check-only does not execute a command that would create a file', () => {
    const baseDir = makeTempBaseDir();
    const writeScript = join(baseDir, 'write.js');
    const createdPath = join(baseDir, 'created.txt');
    // script that writes the file when executed
    require('fs').writeFileSync(writeScript, `require('fs').writeFileSync('${createdPath.replace(/\\/g,"\\\\")}', 'x')`);

    const { exitCode, json } = runCli(
      `--check-only --command "node ${writeScript}" --agent-id hermes --agent-name Hermes`,
      baseDir,
    );

    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.executed).toBe(false);
    expect(json.checkOnly).toBe(true);
    // file must NOT exist after check-only
    const fs = require('fs');
    expect(fs.existsSync(createdPath)).toBe(false);
  });
  test('safe command executes through CLI', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--command "node -e \\"console.log(\'safe-hermes-command\')\\""  --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(0);
    expect(json.decision).toBe('allow');
    expect(json.executed).toBe(true);
    expect(json.output).toContain('safe-hermes-command');
    expect(json.exitCode).toBe(0);
  });

  test('dangerous command is blocked and not executed', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--command "rm -rf ." --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(10);
    expect(json.decision).toBe('deny');
    expect(json.executed).toBe(false);
    expect(json.violations).toBeDefined();
    expect(json.violations.length).toBeGreaterThan(0);
    expect(json.output).toBeUndefined();
  });

  test('approval-required command is held and not executed', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli(
      '--command "git push origin master" --agent-id hermes --agent-name Hermes',
      baseDir,
    );

    expect(exitCode).toBe(20);
    expect(json.decision).toBe('requires_approval');
    expect(json.executed).toBe(false);
    expect(json.reasons).toBeDefined();
    expect(json.reasons.length).toBeGreaterThan(0);
    expect(json.output).toBeUndefined();
  });

  test('CLI writes SafeLoop events to temp ledger', () => {
    const baseDir = makeTempBaseDir();

    // Run a safe command
    runCli('--command "node -e \\"1\\""', baseDir);

    // Run a blocked command
    runCli('--command "rm -rf /tmp/test"', baseDir);

    const events = readEvents({ baseDir });
    expect(events.length).toBeGreaterThanOrEqual(2);

    const allowed = events.find(e => e.type === 'command.allowed');
    const blocked = events.find(e => e.type === 'command.blocked');
    expect(allowed).toBeDefined();
    expect(blocked).toBeDefined();
  });

  test('missing --command exits with code 2', () => {
    const baseDir = makeTempBaseDir();
    const { exitCode, json } = runCli('--agent-id hermes', baseDir);

    expect(exitCode).toBe(2);
    expect(json.error).toContain('Missing --command');
  });
});
