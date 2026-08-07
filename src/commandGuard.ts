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

import { spawnSync } from 'child_process';
import { createPolicyGate, type PolicyGateConfig, type OversightMode } from './index';
import { appendEvent } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';
import type { ApprovalGate, ApprovalToken } from './approvalToken';

// --- Types ---

export type GuardDecision = 'allow' | 'deny' | 'requires_approval';

export interface GuardResult {
  decision: GuardDecision;
  executed: boolean;
  output?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  signal?: NodeJS.Signals | string | null;
  timedOut?: boolean;
  spawnError?: string;
  failureKind?: 'policy_denied' | 'approval_required' | 'spawn_failed' | 'process_nonzero' | 'process_timeout' | 'process_succeeded' | 'output_capture_failed';
  command?: string;
  args?: string[];
  cwd?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
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
  cwd?: string;
  approvalGate?: ApprovalGate;
}

export interface CommandGuard {
  run(command: string, options?: CommandGuardRunOptions): GuardResult;
}

export interface CommandGuardRunOptions {
  cwd?: string;
  args?: string[];
  approvalToken?: ApprovalToken;
  approvalContext?: {
    argumentsHash?: string;
    taskId?: string;
    sessionId?: string;
    tenantId?: string;
    agentId?: string;
    environment?: string;
  };
}

// --- Implementation ---

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function outputToString(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
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
    run(command: string, options?: CommandGuardRunOptions): GuardResult {
      const cwd = options?.cwd ?? config.cwd ?? process.cwd();
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
            cwd,
            decision: 'deny',
            violations: decision.violations,
            reasons: decision.reasons,
            oversightMode: decision.oversightMode,
          },
        }, storageOptions);

        return {
          decision: 'deny',
          executed: false,
          failureKind: 'policy_denied',
          command,
          cwd,
          violations: decision.violations,
          reasons: decision.reasons,
          eventId,
        };
      }

      if (decision.requiresApproval) {
        const redemption = options?.approvalToken && config.approvalGate
          ? config.approvalGate.redeem(options.approvalToken, {
              action: command,
              target: cwd,
              argumentsHash: options.approvalContext?.argumentsHash ?? '',
              taskId: options.approvalContext?.taskId ?? caseId,
              sessionId: options.approvalContext?.sessionId ?? sessionId,
              tenantId: options.approvalContext?.tenantId ?? '',
              agentId: options.approvalContext?.agentId ?? agentId,
              environment: options.approvalContext?.environment ?? '',
            })
          : null;

        if (redemption && !redemption.valid) {
          const eventId = generateEventId('guard-approval-denied');
          appendEvent({
            id: eventId,
            type: 'approval.denied',
            agentId,
            agentName,
            caseId,
            sessionId,
            summary: `Approval token rejected before executing: ${command}`,
            metadata: {
              command,
              cwd,
              decision: 'requires_approval',
              approvalFailure: redemption.failure,
              approvalReason: redemption.reason,
              reasons: decision.reasons,
              oversightMode: decision.oversightMode,
            },
          }, storageOptions);

          return {
            decision: 'requires_approval',
            executed: false,
            failureKind: 'approval_required',
            command,
            cwd,
            reasons: [...decision.reasons, redemption.reason ?? 'approval token rejected'],
            eventId,
          };
        }

        if (!redemption?.valid) {
          // --- REQUIRES APPROVAL: command is held ---
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
              cwd,
              decision: 'requires_approval',
              reasons: decision.reasons,
              oversightMode: decision.oversightMode,
            },
          }, storageOptions);

          return {
            decision: 'requires_approval',
            executed: false,
            failureKind: 'approval_required',
            command,
            cwd,
            reasons: decision.reasons,
            eventId,
          };
        }

        appendEvent({
          id: generateEventId('guard-approval-redeemed'),
          type: 'approval.granted',
          agentId,
          agentName,
          caseId,
          sessionId,
          summary: `Approval token accepted before executing: ${command}`,
          metadata: {
            command,
            cwd,
            approvalTokenId: redemption.tokenId,
            decision: 'allow',
            oversightMode: decision.oversightMode,
          },
        }, storageOptions);
      }

      // --- ALLOWED: execute the command ---
      const eventId = generateEventId('guard-allowed');
      const startedAt = new Date().toISOString();
      const started = Date.now();
      let stdout = '';
      let stderr = '';
      let output = '';
      let exitCode: number | undefined = 0;
      let signal: NodeJS.Signals | string | null = null;
      let timedOut = false;
      let spawnError: string | undefined;
      let failureKind: GuardResult['failureKind'] = 'process_succeeded';

      try {
        const result = spawnSync(command, options?.args ?? [], {
          shell: !options?.args,
          cwd,
          timeout: timeoutMs,
          maxBuffer: maxOutputBytes,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        stdout = outputToString(result.stdout);
        stderr = outputToString(result.stderr);
        output = stdout.trim();
        exitCode = typeof result.status === 'number' ? result.status : undefined;
        signal = result.signal;
        spawnError = result.error?.message;
        timedOut = result.error
          ? result.error.name === 'TimeoutError' ||
            (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
            /timed out|timeout/i.test(result.error.message)
          : false;
        if (timedOut) {
          failureKind = 'process_timeout';
        } else if (result.error) {
          failureKind = 'spawn_failed';
        } else if (exitCode && exitCode !== 0) {
          failureKind = 'process_nonzero';
        } else {
          failureKind = 'process_succeeded';
        }
      } catch (err: any) {
        stderr = err?.message ? String(err.message) : String(err);
        output = '';
        exitCode = undefined;
        spawnError = stderr;
        failureKind = 'spawn_failed';
      }
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - started;

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
          cwd,
          decision: 'allow',
          exitCode,
          signal,
          timedOut,
          failureKind,
          stderrLength: stderr.length,
          outputLength: output.length,
          oversightMode: decision.oversightMode,
          startedAt,
          completedAt,
          durationMs,
        },
      }, storageOptions);

      return {
        decision: 'allow',
        executed: true,
        output,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        spawnError,
        failureKind,
        command,
        args: options?.args,
        cwd,
        startedAt,
        completedAt,
        durationMs,
        eventId,
      };
    },
  };
}
