/**
 * Hermes Connector (Dry-Run Detection)
 *
 * Detects whether Hermes agent runtime is present on the local system.
 * Does NOT modify Hermes files. Read-only detection and status reporting.
 *
 * Honest boundary: only the bootstrap-runner.cjs spawnPowerShell path is
 * coverable by SafeLoop's command wrapper. Other Hermes execution paths
 * (direct Node APIs, internal tool calls) are not intercepted.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import type { AgentConnector, ConnectorDetectionResult, ConnectorStatus, ConnectorVerifyResult } from './types';

// Known Hermes paths
const HERMES_BOOTSTRAP_RELATIVE = '.hermes/hermes-agent/apps/desktop/electron/bootstrap-runner.cjs';
const SAFELOOP_PATCH_MARKER = 'SAFELOOP_HERMES_POWERSHELL_GUARD';
const BACKUP_SUFFIX = '.safeloop-backup';

export interface HermesConnectorOptions {
  /** Override the home directory for testing */
  homeDir?: string;
}

export function createHermesConnector(options?: HermesConnectorOptions): AgentConnector {
  const home = options?.homeDir ?? homedir();
  const bootstrapPath = resolve(home, HERMES_BOOTSTRAP_RELATIVE);
  const backupPath = `${bootstrapPath}${BACKUP_SUFFIX}`;

  function readBootstrapContent(): string | null {
    try {
      if (existsSync(bootstrapPath)) {
        return readFileSync(bootstrapPath, 'utf8');
      }
    } catch { /* ignore read errors */ }
    return null;
  }

  return {
    id: 'hermes',
    name: 'Hermes Agent Connector',

    detect(): ConnectorDetectionResult {
      const notes: string[] = [];
      const content = readBootstrapContent();
      const found = content !== null;

      if (found) {
        notes.push(`Hermes bootstrap-runner found at: ${bootstrapPath}`);
      } else {
        notes.push(`Hermes bootstrap-runner NOT found at: ${bootstrapPath}`);
        notes.push('Hermes may not be installed, or is installed at a non-standard location.');
      }

      // Check for backup
      if (existsSync(backupPath)) {
        notes.push(`SafeLoop backup exists: ${backupPath}`);
      }

      // Check env variable
      const envGuard = process.env.SAFELOOP_HERMES_POWERSHELL_GUARD;
      if (envGuard) {
        notes.push(`SAFELOOP_HERMES_POWERSHELL_GUARD env is set: ${envGuard}`);
      } else {
        notes.push('SAFELOOP_HERMES_POWERSHELL_GUARD env is NOT set.');
      }

      return {
        found,
        path: found ? bootstrapPath : undefined,
        notes,
      };
    },

    status(): ConnectorStatus {
      const content = readBootstrapContent();
      const notes: string[] = [];

      if (!content) {
        return {
          connected: false,
          mode: 'unknown',
          notes: ['Hermes bootstrap-runner not found. Cannot determine connection status.'],
        };
      }

      // Check if SafeLoop patch marker is present
      const hasPatch = content.includes(SAFELOOP_PATCH_MARKER);

      if (hasPatch) {
        notes.push('SafeLoop preflight patch detected in bootstrap-runner.cjs.');
        notes.push('Hermes PowerShell commands should route through SafeLoop before execution.');
        return { connected: true, mode: 'preflight', notes };
      }

      notes.push('SafeLoop preflight patch NOT detected in bootstrap-runner.cjs.');
      notes.push('Hermes is running in observer-only mode (if SafeLoop events are emitted at all).');
      notes.push('To enable control mode, the bootstrap-runner.cjs spawnPowerShell function needs the SafeLoop preflight patch.');
      notes.push('Honest boundary: only spawnPowerShell path is coverable. Direct Node/API calls are not intercepted.');

      return { connected: false, mode: 'observer', notes };
    },

    verify(): ConnectorVerifyResult {
      const content = readBootstrapContent();
      const checks = [];

      checks.push({
        name: 'bootstrap-runner.cjs exists',
        ok: content !== null,
        message: content !== null ? `Found at ${bootstrapPath}` : `Not found at ${bootstrapPath}`,
      });

      checks.push({
        name: 'SafeLoop patch marker present',
        ok: content !== null && content.includes(SAFELOOP_PATCH_MARKER),
        message: content?.includes(SAFELOOP_PATCH_MARKER)
          ? 'SAFELOOP_HERMES_POWERSHELL_GUARD marker found'
          : 'Patch marker not present — Hermes is not gated',
      });

      checks.push({
        name: 'Backup file exists',
        ok: existsSync(backupPath),
        message: existsSync(backupPath)
          ? `Backup at ${backupPath}`
          : 'No backup file — patch may not have been applied',
      });

      const envSet = Boolean(process.env.SAFELOOP_HERMES_POWERSHELL_GUARD);
      checks.push({
        name: 'SAFELOOP_HERMES_POWERSHELL_GUARD env set',
        ok: envSet,
        message: envSet
          ? `Set to: ${process.env.SAFELOOP_HERMES_POWERSHELL_GUARD}`
          : 'Not set — preflight will not trigger without this env variable',
      });

      checks.push({
        name: 'Honest boundary acknowledged',
        ok: true,
        message: 'Only bootstrap-runner spawnPowerShell path is covered. Other Hermes execution paths are not intercepted by SafeLoop.',
      });

      const ok = checks.every(c => c.ok);
      return { ok, checks };
    },
  };
}
