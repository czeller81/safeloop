import { existsSync } from 'fs';
import { resolve } from 'path';
import { readJsonFile, resolveSafeloopPath, writeJsonFile, type SafeloopStorageOptions } from './localStorage';
import type { OversightMode, PolicyGateConfig, PolicyRisk } from './index';

export interface SafeloopPolicyConfig extends PolicyGateConfig {
  version: 1;
  defaultAgentId?: string;
  defaultAgentName?: string;
  defaultCaseId?: string;
}

export interface PolicyConfigReadResult {
  path: string;
  exists: boolean;
  policy: SafeloopPolicyConfig;
}

export const DEFAULT_SAFELOOP_POLICY: SafeloopPolicyConfig = {
  version: 1,
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

export function normalizeSafeloopPolicyConfig(value: unknown): SafeloopPolicyConfig {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    ...DEFAULT_SAFELOOP_POLICY,
    version: 1,
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
