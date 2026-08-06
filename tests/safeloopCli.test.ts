import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { appendEvent } from '../src/eventStream';

const CLI_PATH = resolve(__dirname, '..', 'src', 'cli.ts');

function makeBaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-main-cli-'));
}

function runCli(args: string, baseDir: string): { exitCode: number; json: any; stdout: string } {
  try {
    const stdout = execSync(
      `node -r ts-node/register "${CLI_PATH}" ${args} --baseDir "${baseDir}"`,
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '' } },
    ).trim();
    return { exitCode: 0, json: JSON.parse(stdout), stdout };
  } catch (error: any) {
    const stdout = (error.stdout ?? '').toString().trim();
    return {
      exitCode: error.status ?? 1,
      json: stdout ? JSON.parse(stdout) : {},
      stdout,
    };
  }
}

describe('safeloop main CLI', () => {
  test('init writes local policy config', () => {
    const baseDir = makeBaseDir();
    const result = runCli('init --json', baseDir);
    const policyPath = join(baseDir, '.safeloop', 'policy.json');

    expect(result.exitCode).toBe(0);
    expect(existsSync(policyPath)).toBe(true);
    expect(JSON.parse(readFileSync(policyPath, 'utf8')).blockedCommands).toContain('rm -rf');
  });

  test('init k12 profile writes policy json and markdown intent', () => {
    const baseDir = makeBaseDir();
    const result = runCli('init --profile k12-offline-rag --json', baseDir);
    const policyPath = join(baseDir, '.safeloop', 'policy.json');
    const markdownPath = join(baseDir, '.safeloop', 'policy.md');
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

    expect(result.exitCode).toBe(0);
    expect(policy.profile).toBe('k12-offline-rag');
    expect(policy.requireApprovalFor).toContain('curl');
    expect(policy.blockedCommands).toContain('Remove-Item .safeloop');
    expect(existsSync(markdownPath)).toBe(true);
    expect(readFileSync(markdownPath, 'utf8')).toContain('K-12 Offline RAG Appliance Policy');
  });

  test('policy doctor and compile support markdown intent workflow', () => {
    const baseDir = makeBaseDir();
    runCli('init --profile k12-offline-rag --json', baseDir);

    const doctor = runCli('policy doctor --json', baseDir);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.profile).toBe('k12-offline-rag');
    expect(doctor.json.ok).toBe(true);

    const policyMarkdownPath = join(baseDir, '.safeloop', 'policy.md');
    const existing = readFileSync(policyMarkdownPath, 'utf8');
    writeFileSync(policyMarkdownPath, `${existing}\n## Blocked\n\n- District-specific blocked script \`bad-script.ps1\`.\n`, 'utf8');

    const compiled = runCli('policy compile --profile k12-offline-rag --json', baseDir);
    const policy = JSON.parse(readFileSync(join(baseDir, '.safeloop', 'policy.json'), 'utf8'));

    expect(compiled.exitCode).toBe(0);
    expect(compiled.json.extracted.blockedCommands).toContain('bad-script.ps1');
    expect(policy.blockedCommands).toContain('bad-script.ps1');
  });

  test('check uses policy config and does not execute', () => {
    const baseDir = makeBaseDir();
    runCli('init --json', baseDir);

    const result = runCli('check --command "rm -rf ."', baseDir);

    expect(result.exitCode).toBe(10);
    expect(result.json.decision).toBe('deny');
    expect(result.json.executed).toBe(false);
    expect(result.json.policyExists).toBe(true);
  });

  test('run executes allowed commands and holds approval-required commands', () => {
    const baseDir = makeBaseDir();
    runCli('init --json', baseDir);

    const allowed = runCli('run --command "node -e \\"console.log(\'SAFELOOP_MAIN_CLI\')\\""', baseDir);
    const approval = runCli('run --command "git push origin main"', baseDir);

    expect(allowed.exitCode).toBe(0);
    expect(allowed.json.decision).toBe('allow');
    expect(allowed.json.executed).toBe(true);
    expect(allowed.json.output).toContain('SAFELOOP_MAIN_CLI');
    expect(approval.exitCode).toBe(20);
    expect(approval.json.decision).toBe('requires_approval');
    expect(approval.json.executed).toBe(false);
  });

  test('ledger seal and verify commands report tampering', () => {
    const baseDir = makeBaseDir();
    appendEvent({
      id: 'evt-1',
      type: 'task.started',
      agentId: 'agent',
      caseId: 'case',
      summary: 'start',
    }, { baseDir });

    const sealed = runCli('ledger seal', baseDir);
    expect(sealed.exitCode).toBe(0);
    expect(sealed.json.eventCount).toBe(1);

    appendEvent({
      id: 'evt-2',
      type: 'task.completed',
      agentId: 'agent',
      caseId: 'case',
      summary: 'after seal',
    }, { baseDir });

    const verified = runCli('ledger verify', baseDir);
    expect(verified.exitCode).toBe(30);
    expect(verified.json.ok).toBe(false);
  });

  test('appliance doctor and audit export commands run against initialized profile', () => {
    const baseDir = makeBaseDir();
    runCli('init --profile k12-offline-rag --json', baseDir);

    const doctor = runCli('appliance doctor --json --host generic', baseDir);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json.profile).toBe('k12-offline-rag');
    expect(doctor.json.ok).toBe(true);

    const outPath = join(baseDir, 'audit.json');
    const exported = runCli(`audit export --json --host generic --out "${outPath}"`, baseDir);
    expect(exported.exitCode).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    expect(exported.json.bundle.localOnly).toBe(true);
  });
});
