import { existsSync, statSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';
import { verifyLedger } from './ledgerIntegrity';
import { runMcpDoctor, type McpDoctorResult } from './mcpDiagnostics';
import { readSafeloopPolicyConfig, runPolicyDoctor, type SafeloopPolicyProfile } from './policyConfig';
import { readEventsWithDiagnostics } from './eventStream';

export type ApplianceDoctorStatus = 'pass' | 'warn' | 'fail';

export interface ApplianceDoctorCheck {
  name: string;
  status: ApplianceDoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApplianceDoctorResult {
  ok: boolean;
  generatedAt: string;
  profile: SafeloopPolicyProfile;
  baseDir: string;
  safeloopDir: string;
  deploymentManifestPath: string;
  checks: ApplianceDoctorCheck[];
  policy: ReturnType<typeof runPolicyDoctor>;
  ledger: ReturnType<typeof verifyLedger>;
  mcp?: McpDoctorResult;
  notes: string[];
}

export interface ApplianceDoctorOptions extends SafeloopStorageOptions {
  profile?: SafeloopPolicyProfile;
  host?: string;
  projectRoot?: string;
  includeMcp?: boolean;
}

function check(
  status: ApplianceDoctorStatus,
  name: string,
  message: string,
  details?: Record<string, unknown>,
): ApplianceDoctorCheck {
  return { status, name, message, details };
}

function canStatDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function runApplianceDoctor(options: ApplianceDoctorOptions = {}): ApplianceDoctorResult {
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const safeloopDir = resolve(baseDir, '.safeloop');
  const deploymentManifestPath = resolveSafeloopPath('deployment.json', { baseDir });
  const policyRead = readSafeloopPolicyConfig({ baseDir });
  const profile = options.profile ?? policyRead.policy.profile ?? 'default';
  const policy = runPolicyDoctor({ baseDir });
  const ledger = verifyLedger({ baseDir });
  const eventRead = readEventsWithDiagnostics({ baseDir });
  const includeMcp = options.includeMcp ?? true;
  const mcpDiagnosticBaseDir = mkdtempSync(resolve(tmpdir(), 'safeloop-mcp-doctor-'));
  const mcp = includeMcp
    ? runMcpDoctor({
      baseDir: mcpDiagnosticBaseDir,
      host: options.host ?? 'hermes',
      projectRoot: options.projectRoot ?? process.cwd(),
    })
    : undefined;

  const checks: ApplianceDoctorCheck[] = [];
  checks.push(canStatDirectory(safeloopDir)
    ? check('pass', 'local safeloop directory', `Found local SafeLoop directory at ${safeloopDir}`)
    : check('warn', 'local safeloop directory', `SafeLoop directory does not exist yet at ${safeloopDir}`));
  checks.push(policy.ok
    ? check('pass', 'policy readiness', `Policy profile ${policy.profile} is ready.`)
    : check('fail', 'policy readiness', 'Policy doctor reported blocking issues.', { checks: policy.checks }));
  checks.push(ledger.sealed && ledger.ok
    ? check('pass', 'ledger seal', 'Ledger seal verifies successfully.', { eventCount: ledger.actualEventCount })
    : ledger.sealed
      ? check('fail', 'ledger seal', ledger.reason ?? 'Ledger seal did not verify.', { eventCount: ledger.actualEventCount })
      : check('warn', 'ledger seal', 'Ledger has not been sealed yet.', { eventCount: ledger.actualEventCount }));
  checks.push(eventRead.diagnostics.malformedLineCount === 0
    ? check('pass', 'event ledger read', `${eventRead.events.length} event(s) readable.`)
    : check('warn', 'event ledger read', `${eventRead.diagnostics.malformedLineCount} malformed event line(s) skipped.`, {
      malformedLineCount: eventRead.diagnostics.malformedLineCount,
    }));
  checks.push(existsSync(deploymentManifestPath)
    ? check('pass', 'deployment manifest', `Found deployment manifest at ${deploymentManifestPath}`)
    : check('warn', 'deployment manifest', `Missing optional deployment manifest at ${deploymentManifestPath}`));

  if (profile === 'k12-offline-rag') {
    const approvals = policyRead.policy.requireApprovalFor ?? [];
    const missing = ['curl', 'Invoke-WebRequest', 'scp', 'rsync', 'robocopy', 'npm install']
      .filter((pattern) => !approvals.includes(pattern));
    checks.push(missing.length === 0
      ? check('pass', 'k12 offline controls', 'Common network, export, sync, and update commands require approval.')
      : check('warn', 'k12 offline controls', `Missing approval patterns: ${missing.join(', ')}`));
  }

  if (mcp) {
    checks.push(mcp.ok
      ? check('pass', 'mcp readiness', `MCP doctor passed for ${mcp.host}.`)
      : check('fail', 'mcp readiness', `MCP doctor reported failures for ${mcp.host}.`, { checks: mcp.checks }));
  }

  const notes = [
    'SafeLoop is cooperative governance, not an OS sandbox.',
    'Agents and tools must route sensitive actions through SafeLoop to be governed.',
    'Offline/local RAG deployments still need district-controlled identity, storage encryption, network controls, backups, retention, and incident response.',
  ];

  return {
    ok: checks.every((entry) => entry.status !== 'fail'),
    generatedAt: new Date().toISOString(),
    profile,
    baseDir,
    safeloopDir,
    deploymentManifestPath,
    checks,
    policy,
    ledger,
    mcp,
    notes,
  };
}
