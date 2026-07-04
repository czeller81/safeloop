/**
 * SafeLoop MCP Command Gateway
 *
 * A local gateway that lets compatible agents route commands through SafeLoop
 * instead of calling raw shell tools directly.
 *
 * Agent → SafeLoop MCP Gateway → CommandGuard → shell
 *
 * Tools:
 * - safeloop.checkCommand: preflight check (no execution)
 * - safeloop.runCommand: governed execution
 * - safeloop.recordActivity: audit-only event
 * - safeloop.status: gateway info
 */

import { createCommandGuard, type GuardResult } from '../commandGuard';
import { appendEvent } from '../eventStream';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import type { SafeloopStorageOptions } from '../localStorage';
import type {
  McpToolInput,
  McpCheckResult,
  McpRunResult,
  McpRecordResult,
  McpStatusResult,
  McpToolName,
  McpRequest,
  McpResponse,
} from './types';

export interface McpGatewayConfig {
  baseDir?: string;
  defaultAgentId?: string;
  defaultAgentName?: string;
  defaultCaseId?: string;
  blockedCommands?: string[];
  requireApprovalFor?: string[];
}

export interface McpGateway {
  call(request: McpRequest): McpResponse;
  checkCommand(input: McpToolInput): McpCheckResult;
  runCommand(input: McpToolInput): McpRunResult;
  recordActivity(input: McpToolInput): McpRecordResult;
  status(): McpStatusResult;
}

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function createMcpGateway(config?: McpGatewayConfig): McpGateway {
  const baseDir = config?.baseDir ?? process.cwd();
  const storageOptions: SafeloopStorageOptions = { baseDir };
  const defaultAgentId = config?.defaultAgentId ?? 'mcp-agent';
  const defaultAgentName = config?.defaultAgentName ?? 'MCP Agent';
  const defaultCaseId = config?.defaultCaseId ?? 'mcp-session';

  const blockedCommands = config?.blockedCommands ?? [
    'rm -rf', 'sudo rm', 'del /s', 'Remove-Item -Recurse -Force', 'DROP TABLE',
  ];
  const requireApprovalFor = config?.requireApprovalFor ?? [
    'git push', 'deploy', 'npm publish',
  ];

  // Ensure ledger directory exists
  const safeloopDir = resolve(baseDir, '.safeloop');
  mkdirSync(safeloopDir, { recursive: true });

  function makeGuard(input: McpToolInput) {
    return createCommandGuard({
      policy: {
        oversightMode: 'HOTL',
        blockedCommands,
        requireApprovalFor,
      },
      sessionId: `mcp-${Date.now()}`,
      caseId: input.caseId ?? defaultCaseId,
      agentId: input.agentId ?? defaultAgentId,
      agentName: input.agentName ?? defaultAgentName,
      storageOptions,
      timeoutMs: 30000,
    });
  }

  function checkCommand(input: McpToolInput): McpCheckResult {
    if (!input.command) {
      return {
        decision: 'deny',
        executed: false,
        checkOnly: true,
        violations: ['Missing command input'],
        reasons: [],
        eventId: generateEventId('mcp-error'),
      };
    }

    const guard = makeGuard(input);
    // Use the guard's internal policy evaluation without executing
    // We create a guard but call it in a way that matches check-only behavior
    // by evaluating the policy directly
    const { createPolicyGate } = require('../index');
    const gate = createPolicyGate({
      oversightMode: 'HOTL',
      blockedCommands,
      requireApprovalFor,
    });

    const decision = gate.evaluate({
      task: input.command,
      requestedCommands: [input.command],
    });

    const eventId = generateEventId('mcp-check');
    let result: McpCheckResult['decision'] = 'allow';
    if (!decision.allowed && !decision.requiresApproval) result = 'deny';
    else if (decision.requiresApproval) result = 'requires_approval';

    appendEvent({
      id: eventId,
      type: result === 'allow' ? 'preflight.allowed' : result === 'deny' ? 'preflight.blocked' : 'preflight.approval_required',
      agentId: input.agentId ?? defaultAgentId,
      agentName: input.agentName ?? defaultAgentName,
      caseId: input.caseId ?? defaultCaseId,
      summary: `MCP checkCommand: ${result} — ${input.command}`,
      metadata: {
        tool: 'safeloop.checkCommand',
        command: input.command,
        decision: result,
        checkOnly: true,
        violations: decision.violations,
        reasons: decision.reasons,
      },
    }, storageOptions);

    return {
      decision: result,
      executed: false,
      checkOnly: true,
      violations: decision.violations.length > 0 ? decision.violations : undefined,
      reasons: decision.reasons.length > 0 ? decision.reasons : undefined,
      eventId,
    };
  }

  function runCommand(input: McpToolInput): McpRunResult {
    if (!input.command) {
      return {
        decision: 'deny',
        executed: false,
        violations: ['Missing command input'],
        reasons: [],
        eventId: generateEventId('mcp-error'),
      };
    }

    const guard = makeGuard(input);
    const guardResult: GuardResult = guard.run(input.command);

    return {
      decision: guardResult.decision,
      executed: guardResult.executed,
      exitCode: guardResult.exitCode,
      output: guardResult.output,
      violations: guardResult.violations,
      reasons: guardResult.reasons,
      eventId: guardResult.eventId,
    };
  }

  function recordActivity(input: McpToolInput): McpRecordResult {
    const eventId = generateEventId('mcp-activity');
    const activityType = input.activityType ?? 'activity.recorded';

    appendEvent({
      id: eventId,
      type: activityType,
      agentId: input.agentId ?? defaultAgentId,
      agentName: input.agentName ?? defaultAgentName,
      caseId: input.caseId ?? defaultCaseId,
      summary: input.summary ?? `Activity: ${activityType}${input.target ? ` — ${input.target}` : ''}`,
      metadata: {
        tool: 'safeloop.recordActivity',
        activityType,
        target: input.target,
        taskId: input.taskId,
        taskName: input.taskName,
        ...(input.metadata ?? {}),
      },
    }, storageOptions);

    return { recorded: true, eventId };
  }

  function statusResult(): McpStatusResult {
    return {
      service: 'SafeLoop MCP Gateway',
      version: '1.0.0',
      tools: ['safeloop.checkCommand', 'safeloop.runCommand', 'safeloop.recordActivity', 'safeloop.status'],
      enforcementBoundary: 'SafeLoop governs commands routed through this gateway. It does not intercept private agent tools automatically.',
      baseDir,
      ledgerPath: resolve(baseDir, '.safeloop', 'events.jsonl'),
    };
  }

  function call(request: McpRequest): McpResponse {
    try {
      switch (request.tool) {
        case 'safeloop.checkCommand':
          return { ok: true, result: checkCommand(request.input) };
        case 'safeloop.runCommand':
          return { ok: true, result: runCommand(request.input) };
        case 'safeloop.recordActivity':
          return { ok: true, result: recordActivity(request.input) };
        case 'safeloop.status':
          return { ok: true, result: statusResult() };
        default:
          return { ok: false, error: `Unknown tool: ${request.tool}` };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return { call, checkCommand, runCommand, recordActivity, status: statusResult };
}
