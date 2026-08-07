import { buildHermesMcpConfig, buildMcporterCommands, runMcpDoctor } from '../src/mcpDiagnostics';
import { resolve, sep } from 'path';

describe('MCP diagnostics', () => {
  test('builds Hermes config for built mode', () => {
    const projectRoot = resolve('/tmp/test-project');
    const config = buildHermesMcpConfig({ mode: 'built', projectRoot });

    expect(config).toContain('mcp_servers:');
    expect(config).toContain('safeloop:');
    expect(config).toContain('"node"');
    // Platform-safe: check for the resolved path of dist/cli.js
    expect(config).toContain(resolve(projectRoot, 'dist', 'cli.js'));
    expect(config).toContain('"mcp"');
    expect(config).toContain('"serve"');
  });

  test('builds Hermes config for source mode', () => {
    const projectRoot = resolve('/tmp/test-project');
    const config = buildHermesMcpConfig({ mode: 'source', projectRoot });

    expect(config).toContain('ts-node/register');
    // Platform-safe: check for the resolved path of src/cli.ts
    expect(config).toContain(resolve(projectRoot, 'src', 'cli.ts'));
    expect(config).toContain('"mcp"');
    expect(config).toContain('"serve"');
  });

  test('builds MCPorter commands', () => {
    const commands = buildMcporterCommands('safeloop');

    expect(commands).toEqual(expect.arrayContaining([
      'npx mcporter list',
      'npx mcporter list safeloop --schema',
      'npx mcporter call safeloop.safeloop.status',
      'npx mcporter call safeloop.safeloop.checkCommand command:"rm -rf ."',
    ]));
  });

  test('doctor validates in-process MCP compatibility', () => {
    const result = runMcpDoctor({ host: 'hermes' });

    expect(result.checks.find((entry) => entry.name === 'initialize')?.status).toBe('pass');
    expect(result.checks.find((entry) => entry.name === 'tools/list')?.status).toBe('pass');
    expect(result.checks.find((entry) => entry.name === 'safeloop.status')?.status).toBe('pass');
    expect(result.checks.find((entry) => entry.name === 'checkCommand')?.status).toBe('pass');
    expect(result.hermesConfig).toContain('mcp_servers:');
    expect(result.mcporterCommands.length).toBeGreaterThan(0);
  });
});
