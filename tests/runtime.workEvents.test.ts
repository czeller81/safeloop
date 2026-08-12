import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { buildSessionWorkGraph } from '../src/runtime/sessionWorkGraph';
import { createRuntimeWorkEvent } from '../src/runtime/workEvents';
import { validateProtocol } from '../src/runtime/schemaValidator';
import type { ActionProposal, ExecutionResult, RuntimeWorkEventType } from '../src/runtime/protocol';

let baseDir: string;
let workspace: string;
let outsideDir: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

function startRuntime(): void {
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
  handle = runtime.startSession({
    agent: { agent_id: 'agent-workgraph', agent_name: 'Work Graph Agent', agent_type: 'test' },
    tenant_id: 'tenant-workgraph',
    workspace,
    profile: 'coding',
  });
  taskId = runtime.startTask(handle.credential, {
    session_id: handle.session.session_id,
    goal: 'build a causal work graph',
  }).task_id;
}

async function proposeAndExecute(action: ActionProposal): Promise<ExecutionResult> {
  const decision = runtime.propose(handle.credential, {
    session_id: handle.session.session_id,
    task_id: taskId,
    action,
  });
  expect(decision.execution_permit).toBeDefined();
  const result = await runtime.execute(handle.credential, {
    session_id: handle.session.session_id,
    permit: decision.execution_permit,
    action,
  });
  expect(result.status).toBe('EXECUTED');
  return result;
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-work-events-'));
  workspace = mkdtempSync(join(tmpdir(), 'safeloop-workspace-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'safeloop-outside-'));
  startRuntime();
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe('runtime work events and session graph projection', () => {
  it('validates and redacts runtime work events', () => {
    const event = createRuntimeWorkEvent({
      type: 'proposal.recorded',
      session_id: 'session-1',
      task_id: 'task-1',
      agent_id: 'agent-1',
      tenant_id: 'tenant-1',
      data: {
        token: 'plain-secret-token',
        nested: { api_key: 'sk-test-secret' },
        text: 'Authorization: Bearer abc123',
      },
    });

    expect(validateProtocol('runtime-work-event', event).valid).toBe(true);
    expect(event.data?.token).toBe('[REDACTED]');
    expect((event.data?.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect(JSON.stringify(event.data)).not.toContain('abc123');
    expect(validateProtocol('runtime-work-event', { ...event, event_schema_version: 2 }).valid).toBe(false);
  });

  it('projects a complete governed session without breaking legacy events', async () => {
    const results: ExecutionResult[] = [];
    for (let index = 0; index < 3; index += 1) {
      results.push(await proposeAndExecute({
        action_kind: 'filesystem',
        operation: 'create',
        target: join(workspace, `inside-${index}.txt`),
        arguments: { content: `inside ${index}` },
        agent_id: 'spoofed-agent-is-rebound',
      }));
    }

    const outsideTarget = join(outsideDir, 'approved.txt');
    const heldAction: ActionProposal = {
      action_kind: 'filesystem',
      operation: 'create',
      target: outsideTarget,
      arguments: { content: 'approved outside workspace' },
      agent_id: 'spoofed-agent-is-rebound',
    };
    const held = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: heldAction,
    });
    expect(held.requires_approval).toBe(true);
    const grant = runtime.grantApproval({
      approval_request_id: held.approval_request!.approval_request_id,
      approver: 'operator',
    });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      token: grant.token,
      action: heldAction,
    });
    expect(redemption.redeemed).toBe(true);
    const approvedResult = await runtime.execute(handle.credential, {
      session_id: handle.session.session_id,
      permit: redemption.execution_permit,
      action: heldAction,
    });
    expect(approvedResult.status).toBe('EXECUTED');
    results.push(approvedResult);

    const latest = results[results.length - 1];
    const candidate = {
      memory_id: 'memory-workgraph-1',
      memory_type: 'procedural',
      situation: 'A governed filesystem write completed with recorded evidence.',
      action: 'Persist a memory only after SafeLoop memory governance approves it.',
      outcome: 'The candidate is bound to the same session, task, evidence, and artifacts.',
      lesson: 'Session graph projection should connect memory decisions to execution evidence.',
      confidence: 0.95,
      evidence: latest.evidence_ids,
      source_artifacts: latest.artifact_ids,
    };
    const memoryDecision = runtime.proposeMemory(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      candidate,
    });
    expect(memoryDecision.allowed).toBe(true);
    const memoryWrite = runtime.persistMemory(handle.credential, {
      session_id: handle.session.session_id,
      candidate,
      decision: memoryDecision,
    });
    expect(memoryWrite.activated).toBe(true);

    runtime.finishTask(handle.credential, { session_id: handle.session.session_id, task_id: taskId });
    runtime.finishSession(handle.credential, handle.session.session_id);

    appendEvent({
      id: 'legacy-without-work-event',
      type: 'tool.executed',
      agentId: 'legacy-agent',
      sessionId: handle.session.session_id,
      summary: 'legacy event without work metadata',
      metadata: { task_id: taskId },
    }, { baseDir });

    const graph = buildSessionWorkGraph(handle.session.session_id, { baseDir });
    const types = new Set(graph.events.map((event) => event.type));
    const expectedTypes: RuntimeWorkEventType[] = [
      'session.started',
      'task.started',
      'proposal.recorded',
      'decision.recorded',
      'approval.requested',
      'approval.granted',
      'approval.redeemed',
      'permit.issued',
      'permit.consumed',
      'execution.started',
      'execution.completed',
      'verification.recorded',
      'evidence.recorded',
      'artifact.recorded',
      'memory.candidate.recorded',
      'memory.decision.recorded',
      'memory.persisted',
      'task.completed',
      'session.completed',
    ];

    for (const type of expectedTypes) {
      expect(types.has(type)).toBe(true);
    }
    expect(graph.diagnostics.work_event_count).toBeGreaterThanOrEqual(25);
    expect(graph.diagnostics.legacy_event_count).toBeGreaterThan(graph.diagnostics.work_event_count);
    expect(graph.tasks).toHaveLength(1);
    expect(graph.evidence.length).toBeGreaterThanOrEqual(1);
    expect(graph.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(graph.memories).toHaveLength(1);
    expect(graph.diagnostics.dangling_internal_edge_count).toBe(0);
    const eventIds = new Set(graph.events.map((event) => event.id));
    for (const edge of graph.edges.filter((entry) => entry.scope === 'internal')) {
      expect(eventIds.has(edge.from)).toBe(true);
      expect(eventIds.has(edge.to)).toBe(true);
      expect(edge.from).not.toMatch(/^(proposal|decision|approval|permit|execution|memory)-/);
    }
    const proposal = graph.events.find((event) => event.type === 'proposal.recorded' && event.proposal_id === held.proposal_id);
    const decisionEvent = graph.events.find((event) => event.type === 'decision.recorded' && event.decision_id === held.decision_id);
    const approvalRequest = graph.events.find((event) => event.type === 'approval.requested' && event.approval_request_id === held.approval_request!.approval_request_id);
    const approvalGrant = graph.events.find((event) => event.type === 'approval.granted' && event.approval_id === grant.approval_id);
    const permitIssued = graph.events.find((event) => event.type === 'permit.issued' && event.permit_id === redemption.execution_permit!.permit_id);
    const permitConsumed = graph.events.find((event) => event.type === 'permit.consumed' && event.permit_id === redemption.execution_permit!.permit_id);
    const executionStarted = graph.events.find((event) => event.type === 'execution.started' && event.execution_id === approvedResult.execution_id);
    const verification = graph.events.find((event) => event.type === 'verification.recorded' && event.execution_id === approvedResult.execution_id);
    const memoryCandidate = graph.events.find((event) => event.type === 'memory.candidate.recorded' && event.memory_candidate_id === candidate.memory_id);
    expect(decisionEvent?.parent_event_id).toBe(proposal?.id);
    expect(approvalRequest?.parent_event_id).toBe(decisionEvent?.id);
    expect(approvalGrant?.parent_event_id).toBe(approvalRequest?.id);
    expect(permitIssued?.parent_event_id).toBeDefined();
    expect(permitConsumed?.parent_event_id).toBe(permitIssued?.id);
    expect(executionStarted?.parent_event_id).toBe(permitConsumed?.id);
    expect(verification?.parent_event_id).toBe(executionStarted?.id);
    expect(memoryCandidate?.parent_event_id).toBeDefined();
    expect(eventIds.has(memoryCandidate!.parent_event_id!)).toBe(true);
    expect(graph.edges.some((edge) => edge.from === executionStarted?.id && edge.to === memoryCandidate?.parent_event_id)).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'references_evidence')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'references_artifact')).toBe(true);
    expect(graph.edges.some((edge) => edge.to === candidate.memory_id)).toBe(true);
    expect(graph.events.every((event) => validateProtocol('runtime-work-event', event).valid)).toBe(true);
  });
});
