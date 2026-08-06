import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ensureParentDir, readJsonFile, resolveSafeloopPath, writeJsonFile, type SafeloopStorageOptions } from './localStorage';
import type { OversightMode, PolicyGateConfig, PolicyRisk } from './index';

export type SafeloopPolicyProfile = 'default' | 'k12-offline-rag';

export interface SafeloopPolicyConfig extends PolicyGateConfig {
  version: 1;
  profile?: SafeloopPolicyProfile;
  policyName?: string;
  policyIntentPath?: string;
  defaultAgentId?: string;
  defaultAgentName?: string;
  defaultCaseId?: string;
}

export interface PolicyConfigReadResult {
  path: string;
  exists: boolean;
  policy: SafeloopPolicyConfig;
}

export interface PolicyInitResult extends PolicyConfigReadResult {
  markdownPath: string;
  markdownWritten: boolean;
}

export interface PolicyCompileResult extends PolicyConfigReadResult {
  sourcePath: string;
  extracted: {
    allowedCommands: string[];
    blockedCommands: string[];
    requireApprovalFor: string[];
  };
  warnings: string[];
}

export type PolicyDoctorStatus = 'pass' | 'warn' | 'fail';

export interface PolicyDoctorCheck {
  name: string;
  status: PolicyDoctorStatus;
  message: string;
}

export interface PolicyDoctorResult {
  ok: boolean;
  policyPath: string;
  markdownPath: string;
  policyExists: boolean;
  markdownExists: boolean;
  profile: SafeloopPolicyProfile;
  checks: PolicyDoctorCheck[];
}

export const DEFAULT_SAFELOOP_POLICY: SafeloopPolicyConfig = {
  version: 1,
  profile: 'default',
  policyName: 'SafeLoop default local policy',
  policyIntentPath: '.safeloop/policy.md',
  oversightMode: 'HOTL',
  blockedCommands: [
    'rm -rf',
    'sudo rm',
    'del /s',
    'Remove-Item -Recurse -Force',
    'DROP TABLE',
  ],
  requireApprovalFor: ['git push', 'deploy', 'npm publish'],
  allowedFiles: [],
  allowedCommands: [],
  maxRisk: 'high',
  defaultAgentId: 'local-agent',
  defaultAgentName: 'Local Agent',
  defaultCaseId: 'local-session',
};

export const K12_OFFLINE_RAG_POLICY: SafeloopPolicyConfig = {
  ...DEFAULT_SAFELOOP_POLICY,
  profile: 'k12-offline-rag',
  policyName: 'K-12 offline RAG appliance policy',
  blockedCommands: [
    ...(DEFAULT_SAFELOOP_POLICY.blockedCommands ?? []),
    'Disable-SafeLoop',
    'Stop-Process safeloop',
    'rm .safeloop',
    'Remove-Item .safeloop',
  ],
  requireApprovalFor: [
    ...(DEFAULT_SAFELOOP_POLICY.requireApprovalFor ?? []),
    'curl',
    'Invoke-WebRequest',
    'wget',
    'scp',
    'sftp',
    'rsync',
    'robocopy',
    'xcopy',
    'Remove-Item',
    'del',
    'format',
    'diskpart',
    'net use',
    'New-SmbMapping',
    'docker pull',
    'npm install',
    'pip install',
  ],
  defaultAgentId: 'district-local-agent',
  defaultAgentName: 'District Local Agent',
  defaultCaseId: 'district-local-session',
};

const DEFAULT_POLICY_MARKDOWN = `# SafeLoop Local Policy

This file is human-readable policy intent. SafeLoop enforcement uses the compiled JSON file at \`.safeloop/policy.json\`.

## Allowed

- Run local verification commands such as \`npm test\`.
- Read project files needed for the current task.

## Requires Human Review

- Publishing, deployment, or release commands such as \`git push\`, \`deploy\`, and \`npm publish\`.

## Blocked

- Destructive commands such as \`rm -rf\`, \`sudo rm\`, \`del /s\`, \`Remove-Item -Recurse -Force\`, and \`DROP TABLE\`.

## Boundary

SafeLoop is cooperative governance. Tools that bypass SafeLoop bypass this policy.
`;

export const K12_OFFLINE_RAG_POLICY_MARKDOWN = `# K-12 Offline RAG Appliance Policy

This file is human-readable policy intent for a school district local AI appliance. SafeLoop enforcement uses the compiled JSON file at \`.safeloop/policy.json\`.

## Allowed

- Query the local vector database.
- Read approved district documentation from local storage.
- Draft internal staff summaries with local citations.
- Run local validation commands such as \`npm test\`.

## Requires Human Review

- Any network access, including \`curl\`, \`Invoke-WebRequest\`, \`wget\`, \`scp\`, \`sftp\`, and \`rsync\`.
- Bulk copy, sync, or export commands such as \`robocopy\` and \`xcopy\`.
- Destructive file changes such as \`Remove-Item\` and \`del\`.
- Disk, NAS, SAN, or removable-media changes such as \`format\`, \`diskpart\`, \`net use\`, and \`New-SmbMapping\`.
- Model, package, or runtime updates such as \`docker pull\`, \`npm install\`, and \`pip install\`.
- Publishing or deployment commands such as \`git push\`, \`deploy\`, and \`npm publish\`.

## Blocked

- Disabling SafeLoop or stopping its guard process, including \`Disable-SafeLoop\` and \`Stop-Process safeloop\`.
- Deleting SafeLoop audit data, including \`rm .safeloop\` and \`Remove-Item .safeloop\`.
- Known destructive commands such as \`rm -rf\`, \`sudo rm\`, \`del /s\`, \`Remove-Item -Recurse -Force\`, and \`DROP TABLE\`.

## Data Rules

- Student PII must stay local unless a records officer approves export.
- Generated answers should cite local district sources when used for policy or records work.
- When evidence is unavailable, the agent should say so instead of relying on general model knowledge.
- Source scans, OCR output, chunks, embeddings, ledgers, and evidence artifacts need district retention rules.

## Approval Roles

- IT administrator: system changes, network access, package updates, storage changes.
- Records officer: student-data export, bulk records operations, deletion workflows.
- Principal or designee: school-level operational approvals.

## Boundary

SafeLoop is cooperative governance. MCP hosts, Hermes tools, ingestion scripts, RAG tools, and maintenance scripts must route sensitive actions through SafeLoop. Tools that bypass SafeLoop bypass this policy.
`;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function asOversightMode(value: unknown): OversightMode | undefined {
  return value === 'HITL' || value === 'HOTL' || value === 'HOOTL' ? value : undefined;
}

function asPolicyRisk(value: unknown): PolicyRisk | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function asPolicyProfile(value: unknown): SafeloopPolicyProfile | undefined {
  return value === 'default' || value === 'k12-offline-rag' ? value : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function policyForProfile(profile: SafeloopPolicyProfile): SafeloopPolicyConfig {
  return profile === 'k12-offline-rag' ? K12_OFFLINE_RAG_POLICY : DEFAULT_SAFELOOP_POLICY;
}

function markdownForProfile(profile: SafeloopPolicyProfile): string {
  return profile === 'k12-offline-rag' ? K12_OFFLINE_RAG_POLICY_MARKDOWN : DEFAULT_POLICY_MARKDOWN;
}

export function normalizeSafeloopPolicyConfig(value: unknown): SafeloopPolicyConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    ...DEFAULT_SAFELOOP_POLICY,
    version: 1,
    profile: asPolicyProfile(input.profile) ?? DEFAULT_SAFELOOP_POLICY.profile,
    policyName: typeof input.policyName === 'string' ? input.policyName : DEFAULT_SAFELOOP_POLICY.policyName,
    policyIntentPath: typeof input.policyIntentPath === 'string' ? input.policyIntentPath : DEFAULT_SAFELOOP_POLICY.policyIntentPath,
    oversightMode: asOversightMode(input.oversightMode) ?? DEFAULT_SAFELOOP_POLICY.oversightMode,
    allowedFiles: asStringArray(input.allowedFiles) ?? DEFAULT_SAFELOOP_POLICY.allowedFiles,
    allowedCommands: asStringArray(input.allowedCommands) ?? DEFAULT_SAFELOOP_POLICY.allowedCommands,
    blockedCommands: asStringArray(input.blockedCommands) ?? DEFAULT_SAFELOOP_POLICY.blockedCommands,
    requireApprovalFor: asStringArray(input.requireApprovalFor) ?? DEFAULT_SAFELOOP_POLICY.requireApprovalFor,
    maxRisk: asPolicyRisk(input.maxRisk) ?? DEFAULT_SAFELOOP_POLICY.maxRisk,
    defaultAgentId: typeof input.defaultAgentId === 'string' ? input.defaultAgentId : DEFAULT_SAFELOOP_POLICY.defaultAgentId,
    defaultAgentName: typeof input.defaultAgentName === 'string' ? input.defaultAgentName : DEFAULT_SAFELOOP_POLICY.defaultAgentName,
    defaultCaseId: typeof input.defaultCaseId === 'string' ? input.defaultCaseId : DEFAULT_SAFELOOP_POLICY.defaultCaseId,
  };
}

export function resolvePolicyConfigPath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath('policy.json', options);
}

export function resolvePolicyMarkdownPath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath('policy.md', options);
}

export function readSafeloopPolicyConfig(options: SafeloopStorageOptions = {}): PolicyConfigReadResult {
  const path = resolvePolicyConfigPath(options);
  const exists = existsSync(path);
  const raw = readJsonFile<unknown>(path, DEFAULT_SAFELOOP_POLICY);
  return {
    path,
    exists,
    policy: normalizeSafeloopPolicyConfig(raw),
  };
}

export function writeDefaultSafeloopPolicyConfig(options: SafeloopStorageOptions = {}): PolicyConfigReadResult {
  const path = resolvePolicyConfigPath(options);
  writeJsonFile(path, DEFAULT_SAFELOOP_POLICY);
  return {
    path: resolve(path),
    exists: true,
    policy: { ...DEFAULT_SAFELOOP_POLICY },
  };
}

export function initializeSafeloopPolicyConfig(
  options: SafeloopStorageOptions & { profile?: SafeloopPolicyProfile } = {},
): PolicyInitResult {
  const profile = options.profile ?? 'default';
  const policy = policyForProfile(profile);
  const path = resolvePolicyConfigPath(options);
  const markdownPath = resolvePolicyMarkdownPath(options);
  writeJsonFile(path, policy);
  ensureParentDir(markdownPath);
  writeFileSync(markdownPath, markdownForProfile(profile), 'utf8');
  return {
    path: resolve(path),
    exists: true,
    policy: { ...policy },
    markdownPath: resolve(markdownPath),
    markdownWritten: true,
  };
}

function extractSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const values: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      inSection = trimmed.replace(/^##\s+/, '').trim().toLowerCase() === heading.toLowerCase();
      continue;
    }
    if (!inSection || !trimmed.startsWith('-')) continue;
    const bullet = trimmed.replace(/^-\s*/, '').trim();
    const codeMatches = Array.from(bullet.matchAll(/`([^`]+)`/g)).map((match) => match[1].trim());
    if (codeMatches.length > 0) {
      values.push(...codeMatches);
    } else {
      values.push(bullet);
    }
  }
  return unique(values);
}

export function compileSafeloopPolicyMarkdown(
  options: SafeloopStorageOptions & { sourcePath?: string; profile?: SafeloopPolicyProfile } = {},
): PolicyCompileResult {
  const sourcePath = options.sourcePath ? resolve(options.sourcePath) : resolvePolicyMarkdownPath(options);
  const profile = options.profile ?? 'default';
  const basePolicy = policyForProfile(profile);
  const warnings: string[] = [];

  if (!existsSync(sourcePath)) {
    throw new Error(`Policy markdown not found: ${sourcePath}`);
  }

  const markdown = readFileSync(sourcePath, 'utf8');
  const extracted = {
    allowedCommands: extractSection(markdown, 'Allowed'),
    blockedCommands: extractSection(markdown, 'Blocked'),
    requireApprovalFor: extractSection(markdown, 'Requires Human Review'),
  };

  if (extracted.blockedCommands.length === 0) {
    warnings.push('No blocked command patterns were found in the Blocked section.');
  }
  if (extracted.requireApprovalFor.length === 0) {
    warnings.push('No approval-required command patterns were found in the Requires Human Review section.');
  }

  const policy: SafeloopPolicyConfig = {
    ...basePolicy,
    profile,
    policyIntentPath: '.safeloop/policy.md',
    allowedCommands: unique([...(basePolicy.allowedCommands ?? [])]),
    blockedCommands: unique([...basePolicy.blockedCommands ?? [], ...extracted.blockedCommands]),
    requireApprovalFor: unique([...basePolicy.requireApprovalFor ?? [], ...extracted.requireApprovalFor]),
  };

  const path = resolvePolicyConfigPath(options);
  writeJsonFile(path, policy);

  return {
    path: resolve(path),
    exists: true,
    policy,
    sourcePath,
    extracted,
    warnings,
  };
}

function check(status: PolicyDoctorStatus, name: string, message: string): PolicyDoctorCheck {
  return { status, name, message };
}

export function runPolicyDoctor(options: SafeloopStorageOptions = {}): PolicyDoctorResult {
  const policyPath = resolvePolicyConfigPath(options);
  const markdownPath = resolvePolicyMarkdownPath(options);
  const policyExists = existsSync(policyPath);
  const markdownExists = existsSync(markdownPath);
  const { policy } = readSafeloopPolicyConfig(options);
  const profile = policy.profile ?? 'default';
  const checks: PolicyDoctorCheck[] = [];

  checks.push(policyExists
    ? check('pass', 'policy.json', `Found compiled policy at ${policyPath}`)
    : check('fail', 'policy.json', `Missing compiled policy at ${policyPath}`));
  checks.push(markdownExists
    ? check('pass', 'policy.md', `Found human-readable policy at ${markdownPath}`)
    : check('warn', 'policy.md', `Missing human-readable policy at ${markdownPath}`));
  checks.push(policy.oversightMode === 'HOOTL'
    ? check('warn', 'oversight mode', 'HOOTL reduces human oversight for risky actions.')
    : check('pass', 'oversight mode', `Oversight mode is ${policy.oversightMode}.`));

  const blocked = policy.blockedCommands ?? [];
  const approvals = policy.requireApprovalFor ?? [];
  checks.push(blocked.length > 0
    ? check('pass', 'blocked commands', `${blocked.length} blocked command pattern(s) configured.`)
    : check('fail', 'blocked commands', 'No blocked command patterns configured.'));
  checks.push(approvals.length > 0
    ? check('pass', 'approval commands', `${approvals.length} approval-required command pattern(s) configured.`)
    : check('warn', 'approval commands', 'No approval-required command patterns configured.'));

  if (profile === 'k12-offline-rag') {
    const networkPatterns = ['curl', 'Invoke-WebRequest', 'wget', 'scp', 'sftp', 'rsync'];
    const missingNetwork = networkPatterns.filter((pattern) => !approvals.includes(pattern));
    checks.push(missingNetwork.length === 0
      ? check('pass', 'k12 network review', 'Common network/export command patterns require approval.')
      : check('warn', 'k12 network review', `Missing approval patterns: ${missingNetwork.join(', ')}`));
    checks.push(blocked.some((pattern) => pattern.includes('.safeloop'))
      ? check('pass', 'ledger protection', 'SafeLoop audit data deletion patterns are blocked.')
      : check('warn', 'ledger protection', 'SafeLoop audit data deletion patterns are not explicitly blocked.'));
  }

  const ok = checks.every((entry) => entry.status !== 'fail');
  return {
    ok,
    policyPath: resolve(policyPath),
    markdownPath: resolve(markdownPath),
    policyExists,
    markdownExists,
    profile,
    checks,
  };
}
