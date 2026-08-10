/**
 * v0.2 CLI commands: daemon, status, run, certify, init.
 *
 * Kept out of `src/cli.ts` so the existing command surface stays intact.
 * `safeloop run --command "..."` keeps its v0.1 meaning; the new agent-launch
 * form is selected by the `--` separator, so no existing invocation changes
 * behaviour.
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { userInfo } from 'os';
import { startDaemon, DEFAULT_DAEMON_PORT } from './daemon';
import { createSafeloopClient } from './client';
import {
  operatorCredentialFilePath,
  readConnectionFile,
  readOperatorCredentialFile,
  removeConnectionFile,
} from './runtimeAuth';
import { applyLaunchEnvironment, listProfiles, loadProfile } from './profiles';
import { runConformanceSuite, formatConformanceReport } from './conformance';
import { sealLedger, verifyLedger } from '../ledgerIntegrity';
import { RUNTIME_VERSION } from './runtimeCore';
import { PROTOCOL_VERSION, type ManagedPathDeclaration, type RuntimeControlStatus } from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

export interface CliOptions {
  storageOptions: SafeloopStorageOptions;
  json: boolean;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  const inline = args.find((value) => value.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Wait until a predicate holds or the deadline passes. */
async function waitFor(check: () => boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  return check();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- safeloop daemon ------------------------------------------------------

export async function runDaemonCommand(args: string[], options: CliOptions): Promise<number> {
  const action = args[0] ?? 'status';
  const storageOptions = options.storageOptions;

  if (action === 'start') {
    const existing = readConnectionFile(storageOptions);
    if (existing && isProcessAlive(existing.pid)) {
      console.log(`SafeLoop runtime is already running (pid ${existing.pid}) at http://${existing.host}:${existing.port}`);
      return 0;
    }
    if (existing) {
      // A connection file whose process is gone would otherwise strand clients.
      removeConnectionFile(storageOptions);
    }

    const port = Number(flag(args, 'port') ?? DEFAULT_DAEMON_PORT);
    const profile = flag(args, 'profile') ?? 'coding';
    const workspace = resolve(flag(args, 'workspace') ?? process.cwd());

    if (has(args, 'foreground')) {
      const daemon = await startDaemon({ storageOptions, port, defaultProfile: profile, workspace });
      console.log(`SafeLoop runtime ${RUNTIME_VERSION} listening on ${daemon.transports.join(', ')}`);
      console.log(`Protocol: ${PROTOCOL_VERSION}  Profile: ${profile}  Workspace: ${workspace}`);
      // Named, never printed: an agent that can read this log must not thereby
      // become able to approve its own actions.
      console.log(`Operator credential: ${daemon.operatorCredentialPath} (approvals only; do not give this to an agent)`);

      const shutdown = async (): Promise<void> => {
        await daemon.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
      await new Promise(() => undefined); // run until signalled
      return 0;
    }

    // Detached: the runtime must outlive the shell that started it.
    const child = spawn(
      process.execPath,
      [process.argv[1], 'daemon', 'start', '--foreground', '--port', String(port), '--profile', profile, '--workspace', workspace,
        ...(storageOptions.baseDir ? ['--baseDir', storageOptions.baseDir] : [])],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();

    const started = await waitFor(() => {
      const connection = readConnectionFile(storageOptions);
      return Boolean(connection && isProcessAlive(connection.pid));
    }, 10_000);

    if (!started) {
      console.error('SafeLoop runtime did not start within 10s.');
      return 1;
    }
    const connection = readConnectionFile(storageOptions)!;
    console.log(`SafeLoop runtime ${RUNTIME_VERSION} started (pid ${connection.pid}) at http://${connection.host}:${connection.port}`);
    return 0;
  }

  if (action === 'stop') {
    const connection = readConnectionFile(storageOptions);
    if (!connection) {
      console.log('No SafeLoop runtime is running.');
      return 0;
    }
    try {
      process.kill(connection.pid, 'SIGTERM');
    } catch {
      // Already gone; fall through to cleanup.
    }
    await waitFor(() => !isProcessAlive(connection.pid), 5_000);
    removeConnectionFile(storageOptions);
    console.log(`SafeLoop runtime stopped (pid ${connection.pid}).`);
    return 0;
  }

  if (action === 'status') {
    const connection = readConnectionFile(storageOptions);
    if (!connection || !isProcessAlive(connection.pid)) {
      const payload = { running: false, protocol_version: PROTOCOL_VERSION, runtime_version: RUNTIME_VERSION };
      console.log(options.json ? JSON.stringify(payload, null, 2) : 'SafeLoop runtime: NOT RUNNING');
      return options.json ? 0 : 1;
    }
    const payload = {
      running: true,
      pid: connection.pid,
      host: connection.host,
      port: connection.port,
      socket_path: connection.socket_path,
      protocol_version: connection.protocol_version,
      runtime_version: connection.runtime_version,
      started_at: connection.started_at,
    };
    console.log(options.json ? JSON.stringify(payload, null, 2)
      : `SafeLoop runtime: RUNNING (pid ${connection.pid}) http://${connection.host}:${connection.port}`);
    return 0;
  }

  console.error('Usage: safeloop daemon <start|stop|status> [--port <port>] [--profile <profile>] [--foreground]');
  return 1;
}

// --- safeloop approve -----------------------------------------------------

/**
 * Grant a held approval as the human operator.
 *
 * This exists so that "approve out of band" names a real thing. It reads the
 * operator credential from its own 0600 file, which the agent has no reason to
 * hold, and it is the only shipped path to `/v1/approval/grant`.
 */
export async function runApproveCommand(args: string[], options: CliOptions): Promise<number> {
  const requestId = args.find((value) => !value.startsWith('--'));
  if (!requestId) {
    console.error('Usage: safeloop approve <approval_request_id> [--approver <name>]');
    return 1;
  }

  const connection = readConnectionFile(options.storageOptions);
  if (!connection) {
    console.error('No SafeLoop runtime is running. Start one with: safeloop daemon start');
    return 1;
  }

  const operator = readOperatorCredentialFile(options.storageOptions);
  if (!operator) {
    console.error(`No operator credential found at ${operatorCredentialFilePath(options.storageOptions)}.`);
    console.error('It is created when the daemon first starts. Approvals cannot be granted without it.');
    return 1;
  }

  const approver = flag(args, 'approver') ?? userInfo().username ?? 'operator';
  const response = await fetch(`http://${connection.host}:${connection.port}/v1/approval/grant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${operator.credential}` },
    body: JSON.stringify({ approval_request_id: requestId, approver }),
  });

  const payload = await response.json().catch(() => ({})) as { approval_id?: string; error?: string; message?: string };
  if (!response.ok) {
    console.error(`Approval refused (${response.status} ${payload.error ?? 'error'}): ${payload.message ?? ''}`);
    return 1;
  }

  console.log(`Approved ${requestId} as ${approver}.`);
  console.log(`Approval id: ${payload.approval_id}`);
  console.log('The agent may now redeem this approval once.');
  return 0;
}

// --- safeloop status ------------------------------------------------------

function renderManagedPaths(paths: ManagedPathDeclaration[]): string[] {
  return paths.map((path) => {
    const marker = path.state === 'MANAGED' ? '✓' : path.state === 'DISABLED' ? '·' : '!';
    const impact = path.state === 'UNMANAGED' && path.consequential && path.certification_impact
      ? '  ← blocks full-profile certification'
      : '';
    return `    ${marker} ${path.path.padEnd(14)} ${path.state}${impact}`;
  });
}

/** Distinct markers per state. Never collapsed into green/red. */
const CONTROL_MARKER: Record<RuntimeControlStatus['state'], string> = {
  DISABLED: '✓',
  PENDING_VERIFICATION: '…',
  UNREACHABLE: '~',
  UNMANAGED: '!',
  VERIFICATION_FAILED: '✗',
  NOT_APPLICABLE: '·',
};

function renderRuntimeControls(controls: RuntimeControlStatus[]): string[] {
  if (controls.length === 0) return ['    (none declared by this profile)'];

  const lines: string[] = [];
  for (const control of controls) {
    lines.push(`    ${CONTROL_MARKER[control.state]} ${control.name}`);
    lines.push(`        State           ${control.state}`);
    lines.push(`        Enforcement     ${control.enforcement.join(' + ') || '(none)'}`);
    for (const entry of control.policy) {
      // Names and effects only. Environment values are never displayed.
      lines.push(`        Policy          ${entry.name} = [${entry.effect}]`);
    }
    if (control.verification?.performed) {
      lines.push(`        Verification    ${control.verification.passed ? 'PASSED' : 'FAILED'}`
        + (control.verification.verified_by ? ` (${control.verification.verified_by})` : ''));
      if (control.verification.detail) lines.push(`        Detail          ${control.verification.detail}`);
    } else {
      lines.push('        Verification    not yet reported by the adapter');
    }
    lines.push(`        Scope           ${control.boundary}`);
  }
  return lines;
}

export async function runStatusCommand(_args: string[], options: CliOptions): Promise<number> {
  const connection = readConnectionFile(options.storageOptions);
  if (!connection || !isProcessAlive(connection.pid)) {
    if (options.json) {
      console.log(JSON.stringify({ running: false }, null, 2));
      return 0;
    }
    console.log('SafeLoop runtime: NOT RUNNING');
    console.log('Start one with: safeloop daemon start');
    return 1;
  }

  const client = createSafeloopClient({ storageOptions: options.storageOptions });
  const status = await client.status();

  if (options.json) {
    console.log(JSON.stringify({ running: true, connection: { ...connection, credential: '[REDACTED]' }, status }, null, 2));
    return 0;
  }

  const ledger = verifyLedger(options.storageOptions);
  console.log(`SafeLoop runtime ${status.runtime_version}  (${PROTOCOL_VERSION})`);
  console.log(`  Transport      http://${connection.host}:${connection.port}${connection.socket_path ? `, unix:${connection.socket_path}` : ''}`);
  console.log(`  Started        ${status.started_at}`);
  console.log(`  Sessions       ${status.active_sessions} active`);
  console.log(`  Ledger         ${ledger.ok ? 'VERIFIED' : `INVALID — ${ledger.reason ?? 'tamper detected'}`}`);

  for (const session of status.sessions) {
    console.log('');
    console.log(`  Session ${session.session_id}${session.finished_at ? ' (finished)' : ''}`);
    console.log(`    Agent        ${session.agent_name ?? session.agent_id} (${session.agent_id})`);
    console.log(`    Tenant       ${session.tenant_id}`);
    console.log(`    Workspace    ${session.workspace ?? '(none declared)'}`);
    console.log(`    Profile      ${session.profile}    Scenario: ${session.scenario_id ?? '(none)'}`);
    console.log(`    Tasks        ${session.tasks.length ? session.tasks.join(', ') : '(none active)'}`);
    console.log(`    Breaker      ${session.breaker_state}${session.breaker_reason ? ` — ${session.breaker_reason}` : ''}`);
    console.log(`    Budget       ${session.budget_usage.actions} actions used; remaining: ${session.budget_remaining.actions ?? 'unlimited'}`);
    console.log(`    Approvals    ${session.pending_approvals} pending`);
    console.log('    Managed paths:');
    for (const line of renderManagedPaths(session.managed_paths)) console.log(line);
    console.log('    Runtime security controls:');
    for (const line of renderRuntimeControls(session.runtime_controls ?? [])) console.log(line);
    if (session.blocked_reason) {
      console.log('');
      console.log(`    SESSION BLOCKED  ${session.blocked_reason}`);
      console.log('    The session was not permitted to proceed.');
    }
  }

  return 0;
}

// --- safeloop run ---------------------------------------------------------

export function isAgentLaunch(args: string[]): boolean {
  return args.includes('--');
}

export async function runAgentLaunch(args: string[], options: CliOptions): Promise<number> {
  const separator = args.indexOf('--');
  const agentArgv = args.slice(separator + 1);
  if (agentArgv.length === 0) {
    console.error('Usage: safeloop run --profile <profile> -- <agent command> [args...]');
    return 1;
  }

  const profileId = flag(args, 'profile') ?? 'coding';
  const profile = loadProfile(profileId);
  const workspace = resolve(flag(args, 'workspace') ?? process.cwd());
  const tenantId = flag(args, 'tenant') ?? 'local';
  const agentName = flag(args, 'agent') ?? agentArgv[0];

  // 1. Ensure a runtime is available.
  let connection = readConnectionFile(options.storageOptions);
  let startedHere = false;
  if (!connection || !isProcessAlive(connection.pid)) {
    await runDaemonCommand(['start', '--profile', profileId, '--workspace', workspace], options);
    connection = readConnectionFile(options.storageOptions);
    startedHere = true;
  }
  if (!connection) {
    console.error('Could not start a SafeLoop runtime.');
    return 1;
  }

  // 2-8. Establish session, identity, task, workspace, profile, budgets, ledger.
  const client = createSafeloopClient({ storageOptions: options.storageOptions });
  const session = await client.startSession({
    agent: { agent_id: agentName, agent_name: agentName, agent_type: 'cli-launched' },
    tenant_id: tenantId,
    workspace,
    profile: profileId,
  });
  const { task_id } = await session.startTask({ goal: `safeloop run -- ${agentArgv.join(' ')}` });

  console.log(`SafeLoop ${RUNTIME_VERSION} governing: ${agentArgv.join(' ')}`);
  console.log(`  Profile ${profile.id}   Tenant ${tenantId}   Workspace ${workspace}`);
  console.log(`  Session ${session.session.session_id}   Task ${task_id}`);
  console.log('');
  console.log('  Declared paths for this profile:');
  for (const line of renderManagedPaths(profile.managed_paths)) console.log(line);

  const hardening = profile.launch_environment;
  if (hardening && (Object.keys(hardening.set ?? {}).length > 0 || (hardening.unset ?? []).length > 0)) {
    console.log('');
    console.log('  Environment hardening applied to the launched process:');
    for (const [name, value] of Object.entries(hardening.set ?? {})) {
      console.log(`    set   ${name}=${value}`);
    }
    for (const name of hardening.unset ?? []) {
      console.log(`    unset ${name}`);
    }
    if (hardening.rationale) console.log(`    ${hardening.rationale}`);
  }

  const unmanaged = profile.managed_paths.filter(
    (path) => path.state === 'UNMANAGED' && path.consequential,
  );
  if (unmanaged.length > 0) {
    console.log('');
    console.log('  NOTE: this profile has enabled consequential UNMANAGED paths.');
    console.log('  SafeLoop governs actions routed through it. Anything on those paths is not governed');
    console.log('  and requires external controls (OS permissions, containers, network policy).');
  }
  console.log('');

  // 9-10. Hand the adapter its connection details and launch the agent.
  const child = spawn(agentArgv[0], agentArgv.slice(1), {
    stdio: 'inherit',
    env: {
      // Profile-declared hardening first, so SafeLoop's own connection
      // variables below cannot be removed by a profile's `unset` list.
      ...applyLaunchEnvironment(process.env, profile),
      SAFELOOP_RUNTIME_URL: `http://${connection.host}:${connection.port}`,
      SAFELOOP_RUNTIME_CREDENTIAL: connection.credential,
      SAFELOOP_SESSION_ID: session.session.session_id,
      SAFELOOP_SESSION_CREDENTIAL: session.credential,
      SAFELOOP_PROFILE: profile.id,
      SAFELOOP_TENANT: tenantId,
      SAFELOOP_WORKSPACE: workspace,
      SAFELOOP_TASK_ID: task_id,
      SAFELOOP_BASE_DIR: options.storageOptions.baseDir ?? '',
    },
  });

  // 11-12. Monitor the session and record lifecycle events.
  const exitCode = await new Promise<number>((resolvePromise) => {
    child.on('error', (error) => {
      console.error(`Could not launch ${agentArgv[0]}: ${error.message}`);
      resolvePromise(127);
    });
    child.on('close', (code) => resolvePromise(typeof code === 'number' ? code : 1));
  });

  // 13-14. Close the task and seal evidence.
  await session.finishTask(task_id).catch(() => undefined);
  await session.finish().catch(() => undefined);
  const seal = sealLedger(options.storageOptions);

  console.log('');
  console.log(`SafeLoop session complete. Agent exited ${exitCode}.`);
  console.log(`  Ledger sealed: ${seal.eventCount} entries, digest ${seal.rootHash.slice(0, 16)}…`);
  console.log('  Verify with: safeloop ledger verify');

  if (startedHere && has(args, 'stop-runtime')) {
    await runDaemonCommand(['stop'], options);
  }
  return exitCode;
}

// --- safeloop certify -----------------------------------------------------

export async function runCertifyCommand(args: string[], options: CliOptions): Promise<number> {
  const profileId = flag(args, 'profile') ?? 'coding';
  const adapter = flag(args, 'adapter') ?? 'safeloop-runtime';
  const outPath = flag(args, 'out');

  const result = await runConformanceSuite({
    profile: profileId,
    adapter,
    storageOptions: options.storageOptions,
  });

  if (outPath) {
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2));
  }

  console.log(options.json ? JSON.stringify(result, null, 2) : formatConformanceReport(result));
  return result.status === 'NOT_CONFORMANT' ? 1 : 0;
}

// --- safeloop init --------------------------------------------------------

const AGENT_PRESETS: Record<string, { profile: string; description: string }> = {
  coding: { profile: 'coding', description: 'An agent that edits code in a workspace and uses git.' },
  research: { profile: 'research', description: 'An agent that reads sources and writes notes.' },
  assistant: { profile: 'assistant', description: 'A conversational assistant with no shell access.' },
  'strict-local': { profile: 'strict-local', description: 'Regulated or air-gapped work; nothing leaves the host.' },
};

export function runRuntimeInit(args: string[], options: CliOptions): number {
  const agentType = flag(args, 'agent');

  if (!agentType) {
    console.log('SafeLoop init — choose the kind of agent you are governing:');
    console.log('');
    for (const [id, preset] of Object.entries(AGENT_PRESETS)) {
      console.log(`  --agent ${id.padEnd(13)} ${preset.description}`);
    }
    console.log('');
    console.log('Then run:  safeloop init --agent coding [--workspace <path>] [--tenant <id>]');
    return 0;
  }

  const preset = AGENT_PRESETS[agentType];
  if (!preset) {
    console.error(`Unknown agent type: ${agentType}. Available: ${Object.keys(AGENT_PRESETS).join(', ')}`);
    return 1;
  }

  const workspace = resolve(flag(args, 'workspace') ?? process.cwd());
  const tenant = flag(args, 'tenant') ?? 'local';
  const configPath = resolve(workspace, 'safeloop.config.json');

  if (existsSync(configPath) && !has(args, 'force')) {
    console.error(`${configPath} already exists. Re-run with --force to overwrite it.`);
    return 1;
  }

  const config = {
    protocol_version: PROTOCOL_VERSION,
    runtime_version: RUNTIME_VERSION,
    profile: preset.profile,
    tenant_id: tenant,
    workspace,
    created_at: new Date().toISOString(),
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const profile = loadProfile(preset.profile);
  console.log(`Wrote ${configPath}`);
  console.log('');
  console.log(`Profile: ${profile.name} — ${profile.description}`);
  console.log('');
  console.log('  Declared paths:');
  for (const line of renderManagedPaths(profile.managed_paths)) console.log(line);
  console.log('');
  console.log('Next:');
  console.log('  safeloop daemon start');
  console.log(`  safeloop run --profile ${preset.profile} -- <your agent>`);
  console.log('  safeloop status');
  return 0;
}

export function runProfilesCommand(args: string[], options: CliOptions): number {
  const requested = flag(args, 'profile');
  if (requested) {
    const profile = loadProfile(requested);
    console.log(options.json ? JSON.stringify(profile, null, 2) : `${profile.name} (${profile.id}) — ${profile.description}`);
    if (!options.json) {
      console.log('');
      console.log(`  Default disposition: ${profile.default_disposition}`);
      console.log(`  Memory write policy: ${profile.memory_write_policy}`);
      console.log('  Rules:');
      for (const rule of profile.rules) {
        console.log(`    ${rule.disposition.padEnd(20)} ${rule.id} — ${rule.description}`);
      }
      console.log('  Declared paths:');
      for (const line of renderManagedPaths(profile.managed_paths)) console.log(line);
    }
    return 0;
  }

  const profiles = listProfiles().map((id) => loadProfile(id));
  if (options.json) {
    console.log(JSON.stringify(profiles.map(({ id, name, description }) => ({ id, name, description })), null, 2));
    return 0;
  }
  console.log('Available SafeLoop governance profiles:');
  for (const profile of profiles) {
    console.log(`  ${profile.id.padEnd(14)} ${profile.description}`);
  }
  return 0;
}

/** Used by `safeloop run` to detect that git is present before a git proof. */
export function gitAvailable(): boolean {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}
