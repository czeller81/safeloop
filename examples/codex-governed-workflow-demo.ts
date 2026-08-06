/**
 * SafeLoop Codex-Governed Workflow Demo
 *
 * This is a local demo, not an OpenAI/Codex API integration. It represents
 * Codex as an agent identity and routes representative actions through
 * existing SafeLoop governance paths.
 *
 * Run:
 *   npx ts-node examples/codex-governed-workflow-demo.ts
 */

import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { appendEvent, readEvents } from '../src/eventStream';
import { createMcpGateway } from '../src/mcp';
import {
  createEffectGuard,
  evaluateSpecialistAction,
  routeSpecialistTask,
} from '../src/specialistGovernance';

export interface CodexGovernedWorkflowDemoResult {
  baseDir: string;
  routeSpecialistId: string;
  allowedDecision: string;
  allowedExecuted: boolean;
  approvalDecision: string;
  approvalExecuted: boolean;
  blockedDecision: string;
  blockedExecuted: boolean;
  salesTerminalDecision: string;
  deployDecision: string;
  deployExecuted: boolean;
  eventCount: number;
  eventTypes: string[];
}

function prepareLedger(baseDir: string): void {
  const safeloopDir = resolve(baseDir, '.safeloop');
  const eventsPath = resolve(safeloopDir, 'events.jsonl');
  mkdirSync(safeloopDir, { recursive: true });
  if (existsSync(eventsPath)) {
    unlinkSync(eventsPath);
  }
}

export function runCodexGovernedWorkflowDemo(baseDir = resolve(process.cwd(), '.safeloop-codex-demo')): CodexGovernedWorkflowDemoResult {
  prepareLedger(baseDir);

  const agentId = 'codex-local';
  const agentName = 'Codex Local';
  const caseId = 'codex-governed-demo';
  const storageOptions = { baseDir };

  appendEvent({
    id: 'codex-demo-task-started',
    type: 'task.started',
    agentId,
    agentName,
    caseId,
    summary: 'Codex starts a local governed workflow demo',
    metadata: {
      demo: true,
      actor: 'Codex',
      boundary: 'cooperative-local',
    },
  }, storageOptions);

  const route = routeSpecialistTask({
    objective: 'Codex edits TypeScript code and runs local verification',
    requiresInfrastructureSupport: true,
    preferredSupportSpecialist: 'coding',
  });

  appendEvent({
    id: 'codex-demo-route',
    type: 'decision.explained',
    agentId,
    agentName,
    caseId,
    summary: `Specialist route selected: ${route.specialistId}`,
    metadata: {
      route,
      decision: 'route-specialist',
    },
  }, storageOptions);

  const gateway = createMcpGateway({
    baseDir,
    defaultAgentId: agentId,
    defaultAgentName: agentName,
    defaultCaseId: caseId,
  });

  const allowed = gateway.runCommand({
    command: 'node -e "console.log(\'CODEX_SAFELOOP_ALLOW\')"',
    specialistId: 'coding',
    environment: 'development',
    taskId: 'codex-task-allow',
    taskName: 'Run local verification',
  });

  const approval = gateway.runCommand({
    command: 'git push origin main',
    specialistId: 'coding',
    environment: 'production',
    taskId: 'codex-task-review',
    taskName: 'Publish governed change',
  });

  const blocked = gateway.runCommand({
    command: 'rm -rf .',
    specialistId: 'coding',
    environment: 'development',
    taskId: 'codex-task-block',
    taskName: 'Attempt destructive cleanup',
  });

  const salesTerminal = evaluateSpecialistAction({
    specialistId: 'sales',
    command: 'npm test',
    environment: 'development',
    taskId: 'codex-task-sales-terminal',
  });

  appendEvent({
    id: 'codex-demo-sales-denied',
    type: 'decision.made',
    agentId,
    agentName,
    caseId,
    summary: `Sales terminal access: ${salesTerminal.decision}`,
    metadata: {
      specialistId: salesTerminal.specialistId,
      tool: salesTerminal.tool,
      decision: salesTerminal.decision,
      reasonCodes: salesTerminal.reasonCodes,
    },
  }, storageOptions);

  const effects = createEffectGuard({
    storageOptions,
    registeredAdapters: ['terminal_execute'],
    expectedAdapters: ['terminal_execute', 'deploy'],
  });

  const deploy = effects.guardEffect({
    specialistId: 'operations',
    effectClass: 'deploy',
    action: 'deploy production website',
    environment: 'production',
    target: 'production',
    execute: () => 'should not execute',
  });

  appendEvent({
    id: 'codex-demo-evidence',
    type: 'artifact.changed',
    agentId,
    agentName,
    caseId,
    summary: 'Evidence artifact recorded for governed Codex demo',
    metadata: {
      path: 'examples/codex-governed-workflow-demo.ts',
      artifactType: 'demo',
      changeSummary: 'Local proof that allow, review, block, and effect coverage decisions are recorded',
    },
  }, storageOptions);

  appendEvent({
    id: 'codex-demo-task-completed',
    type: 'task.completed',
    agentId,
    agentName,
    caseId,
    summary: 'Codex governed workflow demo completed',
    metadata: {
      allowed: allowed.decision,
      approval: approval.decision,
      blocked: blocked.decision,
      deploy: deploy.decision,
    },
  }, storageOptions);

  const events = readEvents(storageOptions);
  return {
    baseDir,
    routeSpecialistId: route.specialistId,
    allowedDecision: allowed.decision,
    allowedExecuted: allowed.executed,
    approvalDecision: approval.decision,
    approvalExecuted: approval.executed,
    blockedDecision: blocked.decision,
    blockedExecuted: blocked.executed,
    salesTerminalDecision: salesTerminal.decision,
    deployDecision: deploy.decision,
    deployExecuted: deploy.executed,
    eventCount: events.length,
    eventTypes: events.map((event) => event.type),
  };
}

if (require.main === module) {
  const result = runCodexGovernedWorkflowDemo();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
