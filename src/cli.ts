#!/usr/bin/env node
import { createPolicyGate } from './index';
import { runApplianceDoctor } from './applianceDoctor';
import { writeAuditExportBundle } from './auditExport';
import { createCommandGuard } from './commandGuard';
import { evaluateRuntimePolicy, recordRuntimeGovernanceEvent, verifyCandidateMemory } from './runtimeGovernance';
import { sealLedger, verifyLedger } from './ledgerIntegrity';
import { createMcpGateway, startStdioServer } from './mcp';
import {
  buildHermesMcpConfig,
  buildMcporterCommands,
  runMcpDoctor,
} from './mcpDiagnostics';
import { startMonitorServer } from './monitor';
import { buildSessionWorkGraph, type SessionWorkGraph } from './runtime/sessionWorkGraph';
import { buildFlightRecorderSession, redactFlightRecorderValue, type FlightRecorderSession } from './runtime/flightRecorder';
import {
  compileSafeloopPolicyMarkdown,
  initializeSafeloopPolicyConfig,
  readSafeloopPolicyConfig,
  runPolicyDoctor,
  type SafeloopPolicyProfile,
  writeDefaultSafeloopPolicyConfig,
} from './policyConfig';
import {
  isAgentLaunch,
  runAgentLaunch,
  runCertifyCommand,
  runApproveCommand,
  runDaemonCommand,
  runProfilesCommand,
  runRuntimeInit,
  runStatusCommand,
  type CliOptions,
} from './runtime/cliCommands';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** Shared option parsing for the v0.2 runtime commands. */
function runtimeCliOptions(args: string[]): CliOptions {
  const baseDir = parseBaseDir(args);
  return {
    storageOptions: baseDir ? { baseDir } : {},
    json: args.includes('--json'),
  };
}

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

function parseBooleanFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readJsonInput(args: string[]): unknown {
  const inputPath = parseFlagValue(args, '--input');
  if (inputPath) {
    return JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8'));
  }
  if (parseBooleanFlag(args, '--stdin')) {
    return JSON.parse(readFileSync(0, 'utf8'));
  }
  throw new Error('Missing JSON input. Use --input <path> or --stdin.');
}

function parsePolicyProfile(args: string[]): SafeloopPolicyProfile | undefined {
  const value = parseFlagValue(args, '--profile');
  if (!value) return undefined;
  if (value === 'default' || value === 'k12-offline-rag') return value;
  throw new Error(`Unsupported SafeLoop policy profile: ${value}`);
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
  const profile = parsePolicyProfile(args);
  const result = profile
    ? initializeSafeloopPolicyConfig({ baseDir, profile })
    : {
      ...writeDefaultSafeloopPolicyConfig({ baseDir }),
      markdownPath: undefined,
      markdownWritten: false,
    };
  if (parseJsonFlag(args)) {
    printJson(result);
    return;
  }
  console.log(`SafeLoop policy written to ${result.path}`);
  if (result.markdownPath) {
    console.log(`SafeLoop policy intent written to ${result.markdownPath}`);
  }
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


function nonFlagArgs(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--')) {
      if (!value.includes('=') && index + 1 < args.length && !args[index + 1].startsWith('--')) {
        index += 1;
      }
      continue;
    }
    values.push(value);
  }
  return values;
}

function shortValue(value: unknown): string {
  if (value === undefined || value === null) return 'n/a';
  const text = String(value);
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function printProofState(label: string, state: unknown): void {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return;
  const record = state as Record<string, unknown>;
  console.log(`      ${label}`);
  for (const key of ['path', 'exists', 'object_type', 'size_bytes', 'sha256', 'hash_capped', 'repository_identity', 'branch', 'head']) {
    if (key in record) console.log(`        ${key}: ${shortValue(record[key])}`);
  }
}

function printExecutionProofs(graph: SessionWorkGraph): void {
  if (!graph.execution_proofs.length) return;
  console.log('');
  console.log('Execution Proofs:');
  for (const proof of graph.execution_proofs) {
    console.log(`  ${proof.execution_id ?? 'execution'} - ${proof.executor}${proof.operation ? `.${proof.operation}` : ''}`);
    console.log(`    Verification: ${proof.verification_status} - ${proof.verification_summary}`);
    printProofState('Before:', proof.before);
    printProofState('After:', proof.after);
    if (proof.result && typeof proof.result === 'object' && !Array.isArray(proof.result)) {
      const result = proof.result as Record<string, unknown>;
      const fields = ['status', 'exit_code', 'response_status', 'duration_ms', 'stdout_digest', 'stderr_digest', 'summary'];
      console.log('      Result:');
      for (const key of fields) {
        if (key in result) console.log(`        ${key}: ${shortValue(result[key])}`);
      }
    }
    if (proof.evidence_ids?.length) console.log(`    Evidence: ${proof.evidence_ids.join(', ')}`);
    if (proof.artifact_ids?.length) console.log(`    Artifacts: ${proof.artifact_ids.join(', ')}`);
  }
}
function printSessionGraph(graph: SessionWorkGraph): void {
  console.log(`Session ${graph.session_id}`);
  console.log(`Work events: ${graph.diagnostics.work_event_count}`);
  console.log(`Legacy events: ${graph.diagnostics.legacy_event_count}`);
  console.log(`Causal edges: ${graph.edges.length}`);
  if (graph.diagnostics.missing_causal_metadata_count > 0) {
    console.log(`Missing causal metadata: ${graph.diagnostics.missing_causal_metadata_count}`);
  }
  console.log('');

  if (graph.tasks.length === 0) {
    console.log('Tasks: none');
  } else {
    console.log('Tasks:');
    for (const task of graph.tasks) {
      console.log(`  ${task.task_id}`);
      for (const event of task.events) {
        const refs = [
          event.proposal_id,
          event.decision_id,
          event.approval_request_id,
          event.approval_id,
          event.permit_id,
          event.execution_id,
          event.memory_candidate_id,
        ].filter(Boolean).join(' ');
        console.log(`    - ${event.type}${refs ? ` ${refs}` : ''}`);
      }
    }
  }

  printExecutionProofs(graph);

  if (graph.evidence.length || graph.artifacts.length || graph.memories.length) {
    console.log('');
    console.log(`Evidence: ${graph.evidence.length}`);
    console.log(`Artifacts: ${graph.artifacts.length}`);
    console.log(`Memories: ${graph.memories.length}`);
  }
}


function printFlightRecorderSession(flight: FlightRecorderSession): void {
  const s = flight.summary;
  console.log('');
  console.log('SESSION SUMMARY');
  console.log(`  Session: ${s.session_id}`);
  console.log(`  Task: ${s.primary_task_id ?? 'n/a'}`);
  console.log(`  Agent: ${s.agent_id ?? 'n/a'}`);
  console.log(`  Tenant: ${s.tenant_id ?? 'n/a'}`);
  console.log(`  Start: ${s.started_at ?? 'n/a'}`);
  console.log(`  Duration: ${s.duration_ms ?? 0} ms`);
  console.log(`  Executions: ${s.execution_count}`);
  console.log(`  Approvals: ${s.approval_count}`);
  console.log(`  Prevented: ${s.prevented_count}`);
  console.log(`  Evidence: ${s.evidence_count}`);
  console.log(`  Memory events: ${s.memory_event_count}`);

  console.log('');
  console.log('PREVENTED ACTIONS');
  if (!flight.prevented_actions.length) console.log('  none');
  for (const prevented of flight.prevented_actions) {
    console.log(`  - ${prevented.timestamp} ${prevented.category}: ${prevented.reason}`);
    console.log(`    execution_occurred: ${prevented.execution_occurred}`);
  }

  console.log('');
  console.log('INCONSISTENT BLOCKED/EXECUTED RECORDS');
  if (!flight.prevention_conflicts.length) console.log('  none');
  for (const conflict of flight.prevention_conflicts) {
    console.log(`  - ${conflict.blocked_event_id} ${conflict.category}: ${conflict.reason}`);
    console.log(`    execution_occurred: ${conflict.execution_occurred}`);
    console.log(`    execution_events: ${conflict.execution_event_ids.join(', ')}`);
  }

  console.log('');
  console.log('EXECUTIONS');
  const executions = flight.timeline.filter((event) => event.category === 'EXECUTION' || event.category === 'PREVENTED');
  if (!executions.length) console.log('  none');
  for (const event of executions) console.log(`  - ${event.timestamp} ${event.type}: ${event.summary}`);

  console.log('');
  console.log('VERIFICATION');
  if (!flight.execution_proofs.length) console.log('  none');
  for (const proof of flight.execution_proofs) {
    console.log(`  - ${proof.execution_id ?? 'execution'} ${proof.executor}${proof.operation ? `.${proof.operation}` : ''}: ${proof.verification_status}`);
    console.log(`    ${proof.verification_summary}`);
    console.log(`    Limitation: ${proof.limitation}`);
  }

  console.log('');
  console.log('MEMORY');
  if (!flight.memory.length) console.log('  none');
  for (const memory of flight.memory) console.log(`  - ${memory.memory_id}: ${memory.status}${memory.decision ? ` (${memory.decision})` : ''}`);

  console.log('');
  console.log('GOVERNANCE COVERAGE');
  console.log(`  Profile: ${flight.coverage.profile ?? 'unknown'}`);
  console.log(`  ${flight.coverage.summary}`);
  for (const path of flight.coverage.paths) console.log(`  - ${path.path}: ${path.status}`);

  console.log('');
  console.log('WHAT SAFELOOP CANNOT PROVE');
  for (const limitation of flight.known_limitations) console.log(`  - ${limitation}`);
}

function runSession(args: string[]): void {
  const action = args[0];
  if (action !== 'inspect') {
    throw new Error('Usage: safeloop session inspect <session_id> [--json] [--baseDir <path>]');
  }
  const positionals = nonFlagArgs(args.slice(1));
  const sessionId = positionals[0];
  if (!sessionId) {
    throw new Error('Missing session_id. Usage: safeloop session inspect <session_id> [--json] [--baseDir <path>]');
  }
  const baseDir = resolveCliBaseDir(args);
  const graph = buildSessionWorkGraph(sessionId, { baseDir });
  const flight = buildFlightRecorderSession(sessionId, { baseDir });
  if (parseJsonFlag(args)) {
    printJson({ ...(redactFlightRecorderValue(graph) as SessionWorkGraph), flight_recorder: flight });
  } else {
    printSessionGraph(graph);
    printFlightRecorderSession(flight);
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

function printPolicyDoctor(result: ReturnType<typeof runPolicyDoctor>): void {
  console.log(`SafeLoop policy doctor (${result.profile})`);
  for (const entry of result.checks) {
    const marker = entry.status === 'pass' ? 'PASS' : entry.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${entry.name}: ${entry.message}`);
  }
}

function runPolicy(args: string[]): void {
  const action = args[0];
  const baseDir = resolveCliBaseDir(args);

  if (action === 'doctor') {
    const result = runPolicyDoctor({ baseDir });
    if (parseJsonFlag(args)) {
      printJson(result);
    } else {
      printPolicyDoctor(result);
    }
    if (!result.ok) {
      process.exitCode = 50;
    }
    return;
  }

  if (action === 'compile') {
    const profile = parsePolicyProfile(args) ?? readSafeloopPolicyConfig({ baseDir }).policy.profile;
    const sourceArg = args.slice(1).find((value, index, values) => {
      if (value.startsWith('--')) return false;
      const previous = values[index - 1];
      return previous !== '--baseDir' && previous !== '--base-dir' && previous !== '--profile';
    });
    const result = compileSafeloopPolicyMarkdown({
      baseDir,
      sourcePath: sourceArg,
      profile,
    });
    if (parseJsonFlag(args)) {
      printJson(result);
    } else {
      console.log(`SafeLoop policy compiled from ${result.sourcePath}`);
      console.log(`SafeLoop policy written to ${result.path}`);
      for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
      }
    }
    return;
  }

  throw new Error('Usage: safeloop policy <compile|doctor> [policy.md] [--profile <profile>] [--baseDir <path>]');
}

function printSimpleChecks(title: string, checks: Array<{ status: string; name: string; message: string }>): void {
  console.log(title);
  for (const entry of checks) {
    const marker = entry.status === 'pass' ? 'PASS' : entry.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${entry.name}: ${entry.message}`);
  }
}

function runAppliance(args: string[]): void {
  const action = args[0];
  if (action !== 'doctor') {
    throw new Error('Usage: safeloop appliance doctor [--profile <profile>] [--host <host>] [--baseDir <path>]');
  }
  const baseDir = resolveCliBaseDir(args);
  const result = runApplianceDoctor({
    baseDir,
    profile: parsePolicyProfile(args),
    host: parseFlagValue(args, '--host') ?? 'hermes',
    projectRoot: process.cwd(),
  });
  if (parseJsonFlag(args)) {
    printJson(result);
  } else {
    printSimpleChecks(`SafeLoop appliance doctor (${result.profile})`, result.checks);
    console.log('');
    for (const note of result.notes) {
      console.log(`Note: ${note}`);
    }
  }
  if (!result.ok) {
    process.exitCode = 60;
  }
}

function runAudit(args: string[]): void {
  const action = args[0];
  if (action !== 'export') {
    throw new Error('Usage: safeloop audit export [--out <path>] [--host <host>] [--baseDir <path>]');
  }
  const baseDir = resolveCliBaseDir(args);
  const outPath = parseFlagValue(args, '--out');
  const result = writeAuditExportBundle({
    baseDir,
    outPath,
    host: parseFlagValue(args, '--host') ?? 'hermes',
    projectRoot: process.cwd(),
  });
  if (parseJsonFlag(args)) {
    printJson(result);
  } else {
    console.log(`SafeLoop audit bundle written to ${result.path}`);
    console.log(`Events: ${result.bundle.summary.eventCount}`);
    console.log(`Approvals: ${result.bundle.summary.approvalCount}`);
    console.log(`Risks: ${result.bundle.summary.riskCount}`);
    console.log(`Artifacts: ${result.bundle.summary.artifactCount}`);
  }
}

function runGovernance(args: string[]): void {
  const action = args[0];
  const actionArgs = args.slice(1);
  const baseDir = resolveCliBaseDir(actionArgs);

  if (action === 'evaluate') {
    const input = readJsonInput(actionArgs);
    const result = evaluateRuntimePolicy(input as any);
    if (parseBooleanFlag(actionArgs, '--record')) {
      recordRuntimeGovernanceEvent(result.event, { baseDir });
    }
    printJson(result);
    if (result.disposition === 'DENY' || result.disposition === 'STOP_AGENT') {
      process.exitCode = 10;
    } else if (result.disposition === 'REQUIRE_APPROVAL' || result.disposition === 'PAUSE') {
      process.exitCode = 20;
    }
    return;
  }

  if (action === 'memory') {
    const input = readJsonInput(actionArgs) as any;
    const result = verifyCandidateMemory(input.memory ?? input, {
      scenario: input.scenario,
      minimumConfidence: input.minimumConfidence,
      storageOptions: { baseDir },
    });
    printJson(result);
    if (!result.allowed) {
      process.exitCode = result.decision === 'REJECT' ? 10 : 20;
    }
    return;
  }

  throw new Error('Usage: safeloop governance <evaluate|memory> (--input <path>|--stdin) [--record] [--baseDir <path>]');
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
    const initArgs = process.argv.slice(3);
    // `--agent` selects the v0.2 onboarding flow; `--profile` keeps the v0.1
    // policy-config behaviour.
    if (initArgs.includes('--agent') || initArgs.some((value) => value.startsWith('--agent='))) {
      process.exitCode = runRuntimeInit(initArgs, runtimeCliOptions(initArgs));
      return;
    }
    runInit(initArgs);
    return;
  }

  if (command === 'check') {
    runCheck(process.argv.slice(3));
    return;
  }

  if (command === 'run') {
    const runArgs = process.argv.slice(3);
    // `--` selects the v0.2 agent-launch form. Without it, `safeloop run
    // --command "..."` keeps its v0.1 meaning, so no existing invocation
    // changes behaviour.
    if (isAgentLaunch(runArgs)) {
      process.exitCode = await runAgentLaunch(runArgs, runtimeCliOptions(runArgs));
      return;
    }
    runGuardedCommand(runArgs);
    return;
  }

  if (command === 'approve') {
    const approveArgs = process.argv.slice(3);
    process.exitCode = await runApproveCommand(approveArgs, runtimeCliOptions(approveArgs));
    return;
  }

  if (command === 'daemon') {
    const daemonArgs = process.argv.slice(3);
    process.exitCode = await runDaemonCommand(daemonArgs, runtimeCliOptions(daemonArgs));
    return;
  }

  if (command === 'status') {
    const statusArgs = process.argv.slice(3);
    process.exitCode = await runStatusCommand(statusArgs, runtimeCliOptions(statusArgs));
    return;
  }

  if (command === 'certify') {
    const certifyArgs = process.argv.slice(3);
    process.exitCode = await runCertifyCommand(certifyArgs, runtimeCliOptions(certifyArgs));
    return;
  }

  if (command === 'profiles') {
    const profileArgs = process.argv.slice(3);
    process.exitCode = runProfilesCommand(profileArgs, runtimeCliOptions(profileArgs));
    return;
  }

  if (command === 'session') {
    runSession(process.argv.slice(3));
    return;
  }

  if (command === 'ledger') {
    runLedger(process.argv.slice(3));
    return;
  }

  if (command === 'policy') {
    runPolicy(process.argv.slice(3));
    return;
  }

  if (command === 'appliance') {
    runAppliance(process.argv.slice(3));
    return;
  }

  if (command === 'audit') {
    runAudit(process.argv.slice(3));
    return;
  }

  if (command === 'governance') {
    runGovernance(process.argv.slice(3));
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
  console.log('');
  console.log('  Runtime governance (v0.2):');
  console.log('  safeloop init --agent <coding|research|assistant|strict-local> [--workspace <path>]');
  console.log('  safeloop daemon <start|stop|status> [--port <port>] [--profile <profile>] [--foreground]');
  console.log('  safeloop approve <approval_request_id> [--approver <name>]   (operator credential required)');
  console.log('  safeloop run --profile <profile> -- <agent command> [args...]');
  console.log('  safeloop status [--json] [--baseDir <path>]');
  console.log('  safeloop session inspect <session_id> [--json] [--baseDir <path>]');
  console.log('  safeloop certify [--profile <profile>] [--adapter <name>] [--json] [--out <path>]');
  console.log('  safeloop profiles [--profile <profile>] [--json]');
  console.log('');
  console.log('  Agent governance (v0.1):');
  console.log('  safeloop init [--profile <default|k12-offline-rag>] [--baseDir <path>]');
  console.log('  safeloop check --command "<command>" [--baseDir <path>]');
  console.log('  safeloop run --command "<command>" [--baseDir <path>]');
  console.log('  safeloop policy <compile|doctor> [policy.md] [--profile <profile>] [--baseDir <path>]');
  console.log('  safeloop appliance doctor [--profile <profile>] [--host <host>] [--baseDir <path>]');
  console.log('  safeloop audit export [--out <path>] [--host <host>] [--baseDir <path>]');
  console.log('  safeloop governance <evaluate|memory> (--input <path>|--stdin) [--record] [--baseDir <path>]');
  console.log('  safeloop ledger <seal|verify> [--baseDir <path>]');
  console.log('  safeloop mcp <serve|doctor|print-config|mcporter>');
  console.log('  safeloop monitor [--port <port>] [--baseDir <path>] [--externalEvents <path1,path2>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
