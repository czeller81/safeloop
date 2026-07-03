#!/usr/bin/env node
/**
 * SafeLoop Command Wrapper CLI
 *
 * Routes agent commands through SafeLoop's enforced command guard before execution.
 * This is the control path: Agent → SafeLoop Guard → Action
 *
 * Usage:
 *   npx ts-node examples/safeloop-command.ts --command "echo hello"
 *   npx ts-node examples/safeloop-command.ts --command "rm -rf ." --agent-id hermes
 *
 * Exit codes:
 *   0  = allowed command completed successfully
 *   2  = invalid CLI input (missing --command)
 *   10 = blocked by SafeLoop
 *   20 = approval required
 *   non-zero = allowed command executed but command itself failed
 *
 * Hermes instruction:
 *   Every shell command must be routed through:
 *   npx ts-node examples/safeloop-command.ts --command "<COMMAND>" --agent-id hermes --agent-name Hermes
 */

import { createCommandGuard } from '../src/commandGuard';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

// --- Parse CLI arguments ---
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const command = args.command;
if (!command) {
  const errorResult = { error: 'Missing --command argument', exitCode: 2 };
  process.stdout.write(JSON.stringify(errorResult) + '\n');
  process.exit(2);
}

const agentId = args.agentId || 'hermes';
const agentName = args.agentName || 'Hermes';
const caseId = args.caseId || 'hermes-local';
const taskId = args.taskId || 'hermes-command';
const taskName = args.taskName || 'Hermes guarded command';
const baseDir = args.baseDir || process.cwd();

// Ensure .safeloop directory exists
const safeloopDir = resolve(baseDir, '.safeloop');
mkdirSync(safeloopDir, { recursive: true });

// --- Default policy ---
const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    blockedCommands: [
      'rm -rf',
      'sudo rm',
      'del /s',
      'Remove-Item -Recurse -Force',
      'DROP TABLE',
    ],
    requireApprovalFor: [
      'git push',
      'deploy',
      'npm publish',
    ],
  },
  sessionId: `cli-${Date.now()}`,
  caseId,
  agentId,
  agentName,
  storageOptions: { baseDir },
  timeoutMs: 30000,
});

// --- Execute through guard ---
const result = guard.run(command);

// --- Output structured JSON ---
const output: Record<string, unknown> = {
  decision: result.decision,
  executed: result.executed,
};

if (result.exitCode !== undefined) output.exitCode = result.exitCode;
if (result.output !== undefined) output.output = result.output;
if (result.eventId) output.eventId = result.eventId;
if (result.violations && result.violations.length > 0) output.violations = result.violations;
if (result.reasons && result.reasons.length > 0) output.reasons = result.reasons;

process.stdout.write(JSON.stringify(output) + '\n');

// --- Exit with appropriate code ---
if (result.decision === 'deny') {
  process.exit(10);
} else if (result.decision === 'requires_approval') {
  process.exit(20);
} else {
  // allowed — exit with the command's own exit code
  process.exit(result.exitCode ?? 0);
}
