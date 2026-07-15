#!/usr/bin/env node
/**
 * SafeLoop Command Wrapper CLI
 *
 * Routes agent commands through SafeLoop's enforced command guard before execution.
 * This is the control path: Agent → SafeLoop Guard → Action
 *
 * check-only mode: --check-only
 *   Evaluates policy, emits a preflight event, prints compact JSON, NEVER executes the command.
 *
 * Usage:
 *   npx ts-node examples/safeloop-command.ts --command "echo hello"
 *   npx ts-node examples/safeloop-command.ts --check-only --command "rm -rf ." --agent-id hermes
 *
 * Exit codes:
 *   0  = allowed (check-only) OR allowed+executed success
 *   2  = invalid CLI input (missing --command)
 *   10 = blocked by SafeLoop (or preflight failure)
 *   20 = approval required
 *
 * Hermes instruction:
 *   Every shell command must be routed through:
 *   npx ts-node examples/safeloop-command.ts --command "<COMMAND>" --agent-id hermes --agent-name Hermes
 */

import { createCommandGuard } from '../src/commandGuard';
import { createPolicyGate, type PolicyGateConfig } from '../src/index';
import { appendEvent } from '../src/eventStream';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

// --- Parse CLI arguments ---
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // boolean flag
    if (arg === '--check-only') {
      args['checkOnly'] = '1';
      continue;
    }
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

// --- Default policy (shared) ---
const policy = {
  oversightMode: 'HOTL',
  blockedCommands: [
    'rm -rf',
    'sudo rm',
    'del /s',
    'Remove-Item -Recurse -Force',
    'DROP TABLE',
  ],
  requireApprovalFor: ['git push', 'deploy', 'npm publish'],
} as PolicyGateConfig;

const guard = createCommandGuard({
  policy,
  sessionId: `cli-${Date.now()}`,
  caseId,
  agentId,
  agentName,
  storageOptions: { baseDir },
  timeoutMs: 30000,
});

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// --- Check-only preflight (do not execute) ---
if (String(args.checkOnly || '') === '1') {
  try {
    const gate = createPolicyGate(policy);
    const decision = gate.evaluate({
      task: command,
      requestedCommands: [command],
    });

    // Compose event metadata
    const metadata = {
      checkOnly: true,
      executed: false,
      command,
      decision: decision.allowed ? 'allow' : decision.requiresApproval ? 'requires_approval' : 'deny',
      reasons: decision.reasons,
      violations: decision.violations,
    };

    if (!decision.allowed && !decision.requiresApproval) {
      const eventId = generateEventId('preflight-blocked');
      appendEvent(
        {
          id: eventId,
          type: 'command.preflight.blocked',
          agentId,
          agentName,
          caseId,
          sessionId: `cli-${Date.now()}`,
          summary: `Check-only: Command blocked: ${command}`,
          metadata,
        },
        { baseDir },
      );

      process.stdout.write(JSON.stringify({ decision: 'deny', executed: false, checkOnly: true, eventId, violations: decision.violations, reasons: decision.reasons }) + '\n');
      process.exit(10);
    }

    if (decision.requiresApproval) {
      const eventId = generateEventId('preflight-approval');
      appendEvent(
        {
          id: eventId,
          type: 'approval.preflight.requested',
          agentId,
          agentName,
          caseId,
          sessionId: `cli-${Date.now()}`,
          summary: `Check-only: Approval required before executing: ${command}`,
          metadata,
        },
        { baseDir },
      );

      process.stdout.write(JSON.stringify({ decision: 'requires_approval', executed: false, checkOnly: true, eventId, reasons: decision.reasons }) + '\n');
      process.exit(20);
    }

    // Allowed by policy — emit preflight allowed event but DO NOT execute.
    const eventId = generateEventId('preflight-allowed');
    appendEvent(
      {
        id: eventId,
        type: 'command.preflight.allowed',
        agentId,
        agentName,
        caseId,
        sessionId: `cli-${Date.now()}`,
        summary: `Check-only: Command allowed: ${command}`,
        metadata,
      },
      { baseDir },
    );

    process.stdout.write(JSON.stringify({ decision: 'allow', executed: false, checkOnly: true, eventId }) + '\n');
    process.exit(0);
  } catch (err: any) {
    const errorResult = { error: `SafeLoop check-only failed: ${err?.message ?? String(err)}`, exitCode: 10 };
    process.stdout.write(JSON.stringify(errorResult) + '\n');
    process.exit(10);
  }
}

// --- Execute through guard (normal mode: may run the command) ---
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
