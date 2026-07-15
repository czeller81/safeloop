import { createMcpGateway } from '../src/mcp';
import { readEvents } from '../src/eventStream';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempBaseDir(): string {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-mcp-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return baseDir;
}

describe('SafeLoop MCP Gateway', () => {
  test('checkCommand safe command: allow, not executed', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.checkCommand({ command: 'echo hello', agentId: 'test' });
    expect(r.decision).toBe('allow');
    expect(r.executed).toBe(false);
    expect(r.checkOnly).toBe(true);
  });

  test('checkCommand dangerous command: deny, not executed', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.checkCommand({ command: 'rm -rf .', agentId: 'test' });
    expect(r.decision).toBe('deny');
    expect(r.executed).toBe(false);
    expect(r.checkOnly).toBe(true);
    expect(r.violations).toBeDefined();
    expect(r.violations!.length).toBeGreaterThan(0);
  });

  test('checkCommand approval command: requires_approval, not executed', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.checkCommand({ command: 'git push origin master', agentId: 'test' });
    expect(r.decision).toBe('requires_approval');
    expect(r.executed).toBe(false);
    expect(r.checkOnly).toBe(true);
  });

  test('runCommand safe command: allow, executed, output captured', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.runCommand({ command: 'node -e "console.log(\'SAFELOOP_MCP_OK\')"', agentId: 'test' });
    expect(r.decision).toBe('allow');
    expect(r.executed).toBe(true);
    expect(r.output).toContain('SAFELOOP_MCP_OK');
    expect(r.stdout).toContain('SAFELOOP_MCP_OK');
    expect(r.exitCode).toBe(0);
    expect(r.failureKind).toBe('process_succeeded');
  });

  test('runCommand returns real nonzero exit code and stderr', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.runCommand({ command: 'node -e "console.error(\'MCP_ERR\'); process.exit(9)"', agentId: 'test' });
    expect(r.decision).toBe('allow');
    expect(r.executed).toBe(true);
    expect(r.exitCode).toBe(9);
    expect(r.stderr).toContain('MCP_ERR');
    expect(r.failureKind).toBe('process_nonzero');
  });

  test('runCommand dangerous command: deny, not executed', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.runCommand({ command: 'rm -rf .', agentId: 'test' });
    expect(r.decision).toBe('deny');
    expect(r.executed).toBe(false);
    expect(r.output).toBeUndefined();
  });

  test('recordActivity: records event and returns eventId', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.recordActivity({
      activityType: 'file.write',
      agentId: 'kiro',
      agentName: 'Kiro',
      target: 'src/index.ts',
      summary: 'Updated exports',
    });
    expect(r.recorded).toBe(true);
    expect(r.eventId).toBeDefined();

    const events = readEvents({ baseDir });
    const found = events.find(e => e.id === r.eventId);
    expect(found).toBeDefined();
    expect(found!.type).toBe('file.write');
    expect((found!.metadata as any).target).toBe('src/index.ts');
  });

  test('status: returns available tools and boundary', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const s = gw.status();
    expect(s.service).toBe('SafeLoop MCP Gateway');
    expect(s.tools).toContain('safeloop.checkCommand');
    expect(s.tools).toContain('safeloop.runCommand');
    expect(s.tools).toContain('safeloop.recordActivity');
    expect(s.tools).toContain('safeloop.status');
    expect(s.enforcementBoundary).toContain('does not intercept');
    expect(s.enforcementDiagnostics?.registeredAdapters).toContain('terminal_execute');
    expect(s.enforcementDiagnostics?.knownCoverageGaps).toContain('deploy');
  });

  test('call() dispatches correctly', () => {
    const baseDir = makeTempBaseDir();
    const gw = createMcpGateway({ baseDir });
    const r = gw.call({ tool: 'safeloop.status', input: {} });
    expect(r.ok).toBe(true);
    expect((r.result as any).service).toBe('SafeLoop MCP Gateway');
  });
});
