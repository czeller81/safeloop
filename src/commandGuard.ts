/**
 * SafeLoop Local Command Guard
 *
 * Provides enforced policy-gated command execution. Commands are evaluated
 * against a PolicyGate before execution. Blocked and approval-required
 * commands never reach the shell.
 *
 * This is the core enforcement primitive that proves:
 *   Agent → SafeLoop Guard → Action
 *
 * Without the guard, SafeLoop is an observer. With the guard, SafeLoop
 * controls whether the action runs.
 */

import { execSync } from 'child_process';
import { createPolicyGate, type PolicyGateConfig, type OversightMode } from './index';
import { appendEvent } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';

// --- Types ---

export type GuardDecision = 'allow' | 'deny' | 'requires_approval';

export interface GuardResult {
  decision: GuardDecision;
  executed: boolean;
  output?: string;
  exitCode?: number;
  violations?: string[];
  reasons?: string[];
  eventId: string;
}

export interface CommandGuardConfig {
  policy: PolicyGateConfig;
  sessionId?: string;
  caseId?: string;
  agentId?: string;
  agentName?: string;
  storageOptions?: SafeloopStorageOptions;
  /** Maximum execution time in milliseconds (default: 10000) */
  timeoutMs?: number;
  /** Maximum output buffer size in bytes (default: 1MB) */
  maxOutputBytes?: number;
}

export interface CommandGuard {
  run(command: string): GuardResult;
}

// --- Implementation ---

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function createCommandGuard(config: CommandGuardConfig): CommandGuard {
  const gate = createPolicyGate(config.policy);
  const timeoutMs = config.timeoutMs ?? 10000;
  const maxOutputBytes = config.maxOutputBytes ?? 1024 * 1024;
  const storageOptions = config.storageOptions ?? {};
  const sessionId = config.sessionId;
  const caseId = config.caseId ?? 'guard-session';
  const agentId = config.agentId ?? 'command-guard';
  const agentName = config.agentName ?? 'CommandGuard';

  return {
    run(command: string): GuardResult {
      // Evaluate command against policy gate
      const decision = gate.evaluate({
        task: command,
        requestedCommands: [command],
      });

      // --- DENIED: command is blocked ---
      if (!decision.allowed && !decision.requiresApproval) {
        const eventId = generateEventId('guard-blocked');
        appendEvent({
          id: eventId,
          type: 'command.blocked',
          agentId,
          agentName,
          caseId,
          sessionId,
          summary: `Command blocked: ${command}`,
          metadata: {
            command,
            decision: 'deny',
            violations: decision.violations,
            reasons: decision.reasons,
            oversightMode: decision.oversightMode,
          },
        }, storageOptions);

        return {
          decision: 'deny',
          executed: false,
          violations: decision.violations,
          reasons: decision.reasons,
          eventId,
        };
      }

      // --- REQUIRES APPROVAL: command is held ---
      if (decision.requiresApproval) {
        const eventId = generateEventId('guard-approval');
        appendEvent({
          id: eventId,
          type: 'approval.requested',
          agentId,
          agentName,
          caseId,
          sessionId,
          summary: `Approval required before executing: ${command}`,
          metadata: {
            command,
            decision: 'requires_approval',
            reasons: decision.reasons,
            oversightMode: decision.oversightMode,
          },
        }, storageOptions);

        return {
          decision: 'requires_approval',
          executed: false,
          reasons: decision.reasons,
          eventId,
        };
      }

      // --- ALLOWED: execute the command ---
      const eventId = generateEventId('guard-allowed');
      let output = '';
      let exitCode = 0;

      try {
        const result = execSync(command, {
          timeout: timeoutMs,
          maxBuffer: maxOutputBytes,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        output = typeof result === 'string' ? result.trim() : '';
        exitCode = 0;
      } catch (err: any) {
        // execSync throws on non-zero exit code
        output = (err.stdout ?? err.message ?? '').toString().trim();
        exitCode = typeof err.status === 'number' ? err.status : 1;
      }

      appendEvent({
        id: eventId,
        type: 'command.allowed',
        agentId,
        agentName,
        caseId,
        sessionId,
        summary: `Command allowed and executed: ${command}`,
        metadata: {
          command,
          decision: 'allow',
          exitCode,
          outputLength: output.length,
          oversightMode: decision.oversightMode,
        },
      }, storageOptions);

      return {
        decision: 'allow',
        executed: true,
        output,
        exitCode,
        eventId,
      };
    },
  };
}
