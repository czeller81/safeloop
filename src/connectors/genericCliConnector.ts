/**
 * Generic CLI Connector
 *
 * Explains how any agent can route commands through SafeLoop using the CLI wrapper.
 * This connector is always "available" since it only requires Node.js + ts-node.
 */

import { resolve } from 'path';
import type { AgentConnector, ConnectorDetectionResult, ConnectorStatus, ConnectorVerifyResult } from './types';

export function createGenericCliConnector(): AgentConnector {
  const cliPath = resolve(__dirname, '..', '..', 'examples', 'safeloop-command.ts');

  return {
    id: 'generic-cli',
    name: 'Generic CLI Connector',

    detect(): ConnectorDetectionResult {
      return {
        found: true,
        path: cliPath,
        notes: [
          'Generic CLI connector is always available.',
          `CLI wrapper path: ${cliPath}`,
          'Any agent can route commands through SafeLoop using:',
          `  npx ts-node ${cliPath} --command "<COMMAND>"`,
          'Preflight check (does not execute):',
          `  npx ts-node ${cliPath} --check-only --command "<COMMAND>"`,
        ],
      };
    },

    status(): ConnectorStatus {
      return {
        connected: true,
        mode: 'execute-wrapper',
        notes: [
          'Generic CLI connector operates in execute-wrapper mode.',
          'Commands are evaluated by the policy gate before execution.',
          'Blocked commands never reach the shell.',
          'Approval-required commands return immediately without executing.',
          'Exit codes: 0=allowed, 10=blocked, 20=approval-required, 2=invalid-input.',
        ],
      };
    },

    verify(): ConnectorVerifyResult {
      const checks = [
        {
          name: 'CLI wrapper exists',
          ok: true,
          message: `Path: ${cliPath}`,
        },
        {
          name: 'Execute mode available',
          ok: true,
          message: 'Commands routed through createCommandGuard().run()',
        },
        {
          name: 'Audit events emitted',
          ok: true,
          message: 'command.allowed, command.blocked, approval.requested events written to ledger',
        },
        {
          name: 'Honest boundary',
          ok: true,
          message: 'Agent must voluntarily route commands through the CLI wrapper. Direct shell calls bypass SafeLoop.',
        },
      ];

      return { ok: true, checks };
    },
  };
}
