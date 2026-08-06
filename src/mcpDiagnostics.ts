import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { createMcpGateway } from './mcp';
import { handleMessage } from './mcp/stdioServer';
import type { SafeloopStorageOptions } from './localStorage';

export type McpDoctorStatus = 'pass' | 'warn' | 'fail';

export interface McpDoctorCheck {
  name: string;
  status: McpDoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface McpDoctorResult {
  ok: boolean;
  host: string;
  checks: McpDoctorCheck[];
  hermesConfig?: string;
  mcporterCommands: string[];
}

export interface McpConfigOptions {
  host?: 'hermes' | string;
  mode?: 'built' | 'source' | 'npx';
  projectRoot?: string;
}

function commandVersion(command: string, args: string[]): { ok: boolean; value?: string; error?: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 5000,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: String(result.stderr || result.stdout || `exit ${result.status}`).trim() };
  }
  return { ok: true, value: String(result.stdout || result.stderr).trim() };
}

function parseToolContent(response: any): any {
  const text = response?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function check(status: McpDoctorStatus, name: string, message: string, details?: Record<string, unknown>): McpDoctorCheck {
  return { name, status, message, details };
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

export function buildHermesMcpConfig(options: McpConfigOptions = {}): string {
  const mode = options.mode ?? 'built';
  const projectRoot = options.projectRoot ?? process.cwd();

  if (mode === 'npx') {
    return [
      'mcp_servers:',
      '  safeloop:',
      '    command: "npx"',
      '    args:',
      '      - "safeloop"',
      '      - "mcp"',
      '      - "serve"',
    ].join('\n');
  }

  if (mode === 'source') {
    return [
      'mcp_servers:',
      '  safeloop:',
      '    command: "node"',
      '    args:',
      '      - "-r"',
      '      - "ts-node/register"',
      `      - ${quoteYaml(resolve(projectRoot, 'src', 'cli.ts'))}`,
      '      - "mcp"',
      '      - "serve"',
      `    cwd: ${quoteYaml(projectRoot)}`,
    ].join('\n');
  }

  return [
    'mcp_servers:',
    '  safeloop:',
    '    command: "node"',
    '    args:',
    `      - ${quoteYaml(resolve(projectRoot, 'dist', 'cli.js'))}`,
    '      - "mcp"',
    '      - "serve"',
    `    cwd: ${quoteYaml(projectRoot)}`,
  ].join('\n');
}

export function buildMcporterCommands(serverName = 'safeloop'): string[] {
  return [
    'npx mcporter list',
    `npx mcporter list ${serverName} --schema`,
    `npx mcporter call ${serverName}.safeloop.status`,
    `npx mcporter call ${serverName}.safeloop.checkCommand command:"rm -rf ."`,
  ];
}

export function runMcpDoctor(options: SafeloopStorageOptions & { host?: string; projectRoot?: string } = {}): McpDoctorResult {
  const host = options.host ?? 'generic';
  const projectRoot = options.projectRoot ?? process.cwd();
  const checks: McpDoctorCheck[] = [];

  const node = commandVersion('node', ['--version']);
  checks.push(node.ok
    ? check('pass', 'node', `Node.js available: ${node.value}`)
    : check('fail', 'node', `Node.js not available: ${node.error}`));

  const npm = commandVersion('npm', ['--version']);
  checks.push(npm.ok
    ? check('pass', 'npm', `npm available: ${npm.value}`)
    : check('warn', 'npm', `npm not available or not on PATH: ${npm.error}`));

  const builtCliPath = resolve(projectRoot, 'dist', 'cli.js');
  checks.push(existsSync(builtCliPath)
    ? check('pass', 'build', `Built CLI found at ${builtCliPath}`)
    : check('warn', 'build', `Built CLI not found at ${builtCliPath}. Run npm run build before using built-mode MCP config.`));

  const gateway = createMcpGateway({
    baseDir: options.baseDir,
    defaultAgentId: 'mcp-doctor',
    defaultAgentName: 'MCP Doctor',
    defaultCaseId: 'mcp-doctor',
  });

  const initialize = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, gateway);
  checks.push(initialize?.result?.capabilities?.tools
    ? check('pass', 'initialize', 'MCP initialize returned tools capability.')
    : check('fail', 'initialize', 'MCP initialize did not return tools capability.'));

  const tools = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, gateway);
  const toolNames = Array.isArray(tools?.result?.tools) ? tools.result.tools.map((tool: any) => tool.name) : [];
  const expectedTools = ['safeloop.checkCommand', 'safeloop.runCommand', 'safeloop.recordActivity', 'safeloop.status'];
  const missingTools = expectedTools.filter((tool) => !toolNames.includes(tool));
  checks.push(missingTools.length === 0
    ? check('pass', 'tools/list', 'All SafeLoop MCP tools are listed.', { tools: toolNames })
    : check('fail', 'tools/list', `Missing MCP tools: ${missingTools.join(', ')}`, { tools: toolNames }));

  const status = handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'safeloop.status', arguments: {} },
  }, gateway);
  const statusContent = parseToolContent(status);
  checks.push(statusContent?.transport === 'stdio'
    ? check('pass', 'safeloop.status', 'SafeLoop status tool responds with stdio transport.', { ledgerPath: statusContent.ledgerPath })
    : check('fail', 'safeloop.status', 'SafeLoop status tool did not return expected content.'));

  const denied = handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'safeloop.checkCommand', arguments: { command: 'rm -rf .' } },
  }, gateway);
  const deniedContent = parseToolContent(denied);
  checks.push(deniedContent?.decision === 'deny' && deniedContent.executed === false
    ? check('pass', 'checkCommand', 'Dangerous command is denied and not executed.')
    : check('fail', 'checkCommand', 'Dangerous command was not denied as expected.', { response: deniedContent }));

  if (host.toLowerCase() === 'hermes') {
    const hermesConfig = resolve(homedir(), '.hermes', 'config.yaml');
    checks.push(existsSync(hermesConfig)
      ? check('pass', 'hermes config', `Hermes config found at ${hermesConfig}`)
      : check('warn', 'hermes config', `Hermes config not found at ${hermesConfig}. Use safeloop mcp print-config hermes.`));
  }

  return {
    ok: checks.every((entry) => entry.status !== 'fail'),
    host,
    checks,
    hermesConfig: host.toLowerCase() === 'hermes' ? buildHermesMcpConfig({ mode: existsSync(builtCliPath) ? 'built' : 'source', projectRoot }) : undefined,
    mcporterCommands: buildMcporterCommands('safeloop'),
  };
}
