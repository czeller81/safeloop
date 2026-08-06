#!/usr/bin/env node
import { createPolicyGate } from './index';
import { createCommandGuard } from './commandGuard';
import { sealLedger, verifyLedger } from './ledgerIntegrity';
import { createMcpGateway, startStdioServer } from './mcp';
import {
  buildHermesMcpConfig,
  buildMcporterCommands,
  runMcpDoctor,
} from './mcpDiagnostics';
import { startMonitorServer } from './monitor';
import {
  readSafeloopPolicyConfig,
  writeDefaultSafeloopPolicyConfig,
} from './policyConfig';
import { resolve } from 'path';

function parsePort(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--port') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for --port');
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${next}`);
      }
      return parsed;
    }
    if (value.startsWith('--port=')) {
      const parsed = Number(value.slice('--port='.length));
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`Invalid port: ${value.slice('--port='.length)}`);
      }
      return parsed;
    }
  }
  return undefined;
}

function parseBaseDir(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--baseDir' || value === '--base-dir') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for --baseDir');
      }
      return next;
    }
    if (value.startsWith('--baseDir=')) {
      return value.slice('--baseDir='.length);
    }
    if (value.startsWith('--base-dir=')) {
      return value.slice('--base-dir='.length);
    }
  }
  return undefined;
}

function parseExternalEvents(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--externalEvents' || value === '--external-events') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('Missing value for --externalEvents');
      }
      values.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
    }
    if (value.startsWith('--externalEvents=')) {
      values.push(...value.slice('--externalEvents='.length).split(',').map((s) => s.trim()).filter(Boolean));
    }
    if (value.startsWith('--external-events=')) {
      values.push(...value.slice('--external-events='.length).split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return values;
}

function parseFlagValue(args: string[], dashed: string, camel?: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === dashed || (camel && value === camel)) {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${dashed}`);
      }
      return next;
    }
    if (value.startsWith(`${dashed}=`)) {
      return value.slice(dashed.length + 1);
    }
    if (camel && value.startsWith(`${camel}=`)) {
      return value.slice(camel.length + 1);
    }
  }
  return undefined;
}

function parseCommandText(args: string[]): string | undefined {
  const flagged = parseFlagValue(args, '--command');
  if (flagged) return flagged;
  const positional = args.find((value, index) => index > 0 && !value.startsWith('--'));
  return positional;
}

function parseJsonFlag(args: string[]): boolean {
  return args.includes('--json');
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function resolveCliBaseDir(args: string[]): string | undefined {
  const baseDirArg = parseBaseDir(args);
  return baseDirArg ? resolve(process.cwd(), baseDirArg) : undefined;
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE');
}

async function runMonitor(args: string[]): Promise<void> {
  const port = parsePort(args) ?? 3777;
  const baseDirArg = parseBaseDir(args);
  const baseDir = baseDirArg ? resolve(process.cwd(), baseDirArg) : undefined;
  const externalEvents = parseExternalEvents(args);

  try {
    const server = await startMonitorServer({ port, baseDir, externalEventPaths: externalEvents });
    const url = `http://127.0.0.1:${server.port}`;
    console.log(`Safeloop live monitor running at ${url}`);
    console.log('Press Ctrl+C to stop.');
    process.on('SIGINT', async () => {
      await server.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    if (isAddressInUse(error)) {
      console.log('Safeloop monitor already running.');
      console.log('');
      console.log('URL:');
      console.log(`http://127.0.0.1:${port}`);
      return;
    }
    throw error;
  }
}

function runInit(args: string[]): void {
  const baseDir = resolveCliBaseDir(args);
  const result = writeDefaultSafeloopPolicyConfig({ baseDir });
  if (parseJsonFlag(args)) {
    printJson(result);
    return;
  }
  console.log(`SafeLoop policy written to ${result.path}`);
}

function runCheck(args: string[]): void {
  const command = parseCommandText(['check', ...args]);
  if (!command) {
    throw new Error('Missing command. Usage: safeloop check --command "<command>"');
  }
  const baseDir = resolveCliBaseDir(args);
  const config = readSafeloopPolicyConfig({ baseDir });
  const gate = createPolicyGate(config.policy);
  const decision = gate.evaluate({
    task: command,
    requestedCommands: [command],
  });
  const result = {
    decision: decision.allowed ? 'allow' : decision.requiresApproval ? 'requires_approval' : 'deny',
    executed: false,
    checkOnly: true,
    policyPath: config.path,
    policyExists: config.exists,
    violations: decision.violations,
    reasons: decision.reasons,
    oversightMode: decision.oversightMode,
    risk: decision.risk,
  };
  printJson(result);
  if (!decision.allowed && !decision.requiresApproval) {
    process.exitCode = 10;
  } else if (decision.requiresApproval) {
    process.exitCode = 20;
  }
}

function runGuardedCommand(args: string[]): void {
  const command = parseCommandText(['run', ...args]);
  if (!command) {
    throw new Error('Missing command. Usage: safeloop run --command "<command>"');
  }
  const baseDir = resolveCliBaseDir(args);
  const cwd = parseFlagValue(args, '--cwd');
  const config = readSafeloopPolicyConfig({ baseDir });
  const guard = createCommandGuard({
    policy: config.policy,
    agentId: parseFlagValue(args, '--agent-id') ?? config.policy.defaultAgentId,
    agentName: parseFlagValue(args, '--agent-name') ?? config.policy.defaultAgentName,
    caseId: parseFlagValue(args, '--case-id') ?? config.policy.defaultCaseId,
    storageOptions: { baseDir },
    cwd,
  });
  const result = guard.run(command, { cwd });
  printJson({
    ...result,
    policyPath: config.path,
    policyExists: config.exists,
  });
  if (result.decision === 'deny') {
    process.exitCode = 10;
  } else if (result.decision === 'requires_approval') {
    process.exitCode = 20;
  } else {
    process.exitCode = result.exitCode ?? 0;
  }
}

function runLedger(args: string[]): void {
  const action = args[0];
  const baseDir = resolveCliBaseDir(args);
  if (action === 'seal') {
    const seal = sealLedger({ baseDir });
    printJson(seal);
    return;
  }
  if (action === 'verify') {
    const result = verifyLedger({ baseDir });
    printJson(result);
    if (!result.ok) {
      process.exitCode = 30;
    }
    return;
  }
  throw new Error('Usage: safeloop ledger <seal|verify> [--baseDir <path>]');
}

function printDoctor(result: ReturnType<typeof runMcpDoctor>): void {
  console.log(`SafeLoop MCP doctor (${result.host})`);
  for (const entry of result.checks) {
    const marker = entry.status === 'pass' ? 'PASS' : entry.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${entry.name}: ${entry.message}`);
  }
  if (result.hermesConfig) {
    console.log('');
    console.log('Hermes config:');
    console.log(result.hermesConfig);
  }
  console.log('');
  console.log('MCPorter checks:');
  for (const command of result.mcporterCommands) {
    console.log(`  ${command}`);
  }
}

function runMcp(args: string[]): void {
  const action = args[0];
  const baseDir = resolveCliBaseDir(args);

  if (action === 'serve') {
    const gateway = createMcpGateway({
      baseDir,
      defaultAgentId: parseFlagValue(args, '--agent-id') ?? 'mcp-host',
      defaultAgentName: parseFlagValue(args, '--agent-name') ?? 'MCP Host',
      defaultCaseId: parseFlagValue(args, '--case-id') ?? 'mcp-session',
    });
    startStdioServer(gateway);
    return;
  }

  if (action === 'doctor') {
    const host = parseFlagValue(args, '--host') ?? 'generic';
    const result = runMcpDoctor({ baseDir, host, projectRoot: process.cwd() });
    if (parseJsonFlag(args)) {
      printJson(result);
    } else {
      printDoctor(result);
    }
    if (!result.ok) {
      process.exitCode = 40;
    }
    return;
  }

  if (action === 'print-config') {
    const host = args[1] ?? 'hermes';
    const mode = parseFlagValue(args, '--mode') as 'built' | 'source' | 'npx' | undefined;
    if (host !== 'hermes') {
      throw new Error('Only Hermes config output is supported right now.');
    }
    console.log(buildHermesMcpConfig({ host, mode, projectRoot: process.cwd() }));
    return;
  }

  if (action === 'mcporter') {
    for (const command of buildMcporterCommands('safeloop')) {
      console.log(command);
    }
    return;
  }

  throw new Error('Usage: safeloop mcp <serve|doctor|print-config|mcporter>');
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'init') {
    runInit(process.argv.slice(3));
    return;
  }

  if (command === 'check') {
    runCheck(process.argv.slice(3));
    return;
  }

  if (command === 'run') {
    runGuardedCommand(process.argv.slice(3));
    return;
  }

  if (command === 'ledger') {
    runLedger(process.argv.slice(3));
    return;
  }

  if (command === 'mcp') {
    runMcp(process.argv.slice(3));
    return;
  }

  if (command === 'monitor') {
    await runMonitor(process.argv.slice(3));
    return;
  }

  console.log('Safeloop CLI');
  console.log('Usage:');
  console.log('  safeloop init [--baseDir <path>]');
  console.log('  safeloop check --command "<command>" [--baseDir <path>]');
  console.log('  safeloop run --command "<command>" [--baseDir <path>]');
  console.log('  safeloop ledger <seal|verify> [--baseDir <path>]');
  console.log('  safeloop mcp <serve|doctor|print-config|mcporter>');
  console.log('  safeloop monitor [--port <port>] [--baseDir <path>] [--externalEvents <path1,path2>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
