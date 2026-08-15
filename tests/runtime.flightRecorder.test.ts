import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { buildFlightRecorderSession, exportFlightRecorderSession, listFlightRecorderSessions } from '../src/runtime/flightRecorder';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { createRuntimeWorkEvent } from '../src/runtime/workEvents';

let baseDir: string;
let workspace: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-flight-recorder-'));
  workspace = mkdtempSync(join(tmpdir(), 'safeloop-flight-workspace-'));
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
  handle = runtime.startSession({
    agent: { agent_id: 'flight-agent', agent_name: 'Flight Agent' },
    tenant_id: 'tenant-flight',
    workspace,
    profile: 'coding',
  });
  taskId = runtime.startTask(handle.credential, {
    session_id: handle.session.session_id,
    goal: 'explain a governed session',
  }).task_id;
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function appendWorkEvent(event: ReturnType<typeof createRuntimeWorkEvent>): void {
  appendEvent({
    id: `legacy-${event.id}`,
    type: event.type,
    agentId: event.agent_id ?? 'flight-agent',
    sessionId: event.session_id,
    summary: event.summary ?? event.type,
    timestamp: event.timestamp,
    metadata: { workEvent: event },
  }, { baseDir });
}

describe('Flight Recorder projection', () => {
  it('builds a truthful, redacted human session reconstruction from recorded work events', async () => {
    const result = await runtime.execute(handle.credential, {
      session_id: handle.session.session_id,
      permit: runtime.propose(handle.credential, {
        session_id: handle.session.session_id,
        task_id: taskId,
        action: {
          action_kind: 'filesystem',
          operation: 'create',
          target: join(workspace, 'flight.txt'),
          arguments: { content: 'flight recorder proof' },
          agent_id: 'spoofed-agent-is-rebound',
        },
      }).execution_permit,
      action: {
        action_kind: 'filesystem',
        operation: 'create',
        target: join(workspace, 'flight.txt'),
        arguments: { content: 'flight recorder proof' },
        agent_id: 'spoofed-agent-is-rebound',
      },
    });
    expect(result.status).toBe('EXECUTED');

    const candidate = {
      memory_id: 'flight-memory-1',
      memory_type: 'procedural',
      situation: 'A governed filesystem write produced evidence.',
      lesson: 'Use the Flight Recorder to inspect evidence provenance.',
      confidence: 0.88,
      evidence: result.evidence_ids,
      source_artifacts: result.artifact_ids,
    };
    const memoryDecision = runtime.proposeMemory(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      candidate,
    });
    expect(memoryDecision.allowed).toBe(true);
    expect(runtime.persistMemory(handle.credential, {
      session_id: handle.session.session_id,
      candidate,
      decision: memoryDecision,
    }).activated).toBe(true);

    const denied = createRuntimeWorkEvent({
      type: 'decision.recorded',
      id: 'flight-denied-decision',
      timestamp: new Date(Date.parse(handle.session.started_at) + 10_000).toISOString(),
      session_id: handle.session.session_id,
      task_id: taskId,
      agent_id: 'flight-agent',
      tenant_id: 'tenant-flight',
      causes: ['missing-policy-input'],
      data: {
        disposition: 'DENY',
        reason: 'outside policy Authorization: Bearer secret-token',
        operation: 'delete',
        token: 'plain-secret-token',
        profile: 'coding',
      },
    });
    appendWorkEvent(denied);
    appendWorkEvent(createRuntimeWorkEvent({
      type: 'execution.rejected',
      id: 'flight-budget-rejected',
      timestamp: new Date(Date.parse(handle.session.started_at) + 11_000).toISOString(),
      session_id: handle.session.session_id,
      task_id: taskId,
      agent_id: 'flight-agent',
      tenant_id: 'tenant-flight',
      data: { status: 'BUDGET_EXHAUSTED', reason: 'budget exhausted before execution' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      type: 'execution.completed',
      id: 'flight-executed-failed',
      timestamp: new Date(Date.parse(handle.session.started_at) + 12_000).toISOString(),
      session_id: handle.session.session_id,
      task_id: taskId,
      agent_id: 'flight-agent',
      tenant_id: 'tenant-flight',
      data: { status: 'FAILED', reason: 'process ran and returned a failure' },
    }));

    const flight = buildFlightRecorderSession(handle.session.session_id, { baseDir });

    expect(flight.summary.execution_count).toBe(2);
    expect(flight.summary.verified_count).toBeGreaterThanOrEqual(1);
    expect(flight.summary.prevented_count).toBe(2);
    expect(flight.summary.evidence_count).toBeGreaterThanOrEqual(1);
    expect(flight.summary.memory_persisted_count).toBe(1);
    expect(flight.memory).toEqual(expect.arrayContaining([expect.objectContaining({ memory_id: 'flight-memory-1', persisted: true })]));
    expect(flight.prevented_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_id: 'flight-denied-decision',
        category: 'denied_by_policy',
        execution_occurred: false,
      }),
      expect.objectContaining({
        event_id: 'flight-budget-rejected',
        category: 'budget_blocked',
        execution_occurred: false,
      }),
    ]));
    expect(flight.prevented_actions.some((action) => action.event_id === 'flight-executed-failed')).toBe(false);
    expect(flight.timeline.find((event) => event.id === 'flight-denied-decision')?.causal_links.missing_links)
      .toContain('missing-policy-input');
    expect(flight.coverage.paths.find((path) => path.path === 'filesystem')?.status).toBe('MANAGED');
    expect(flight.coverage.paths.find((path) => path.path === 'http')?.status).toBe('UNKNOWN');
    expect(flight.known_limitations).toEqual(expect.arrayContaining([
      'SafeLoop governs routed/managed execution paths, not arbitrary OS activity.',
      'The Flight Recorder reconstructs recorded causal links and does not fabricate missing edges.',
    ]));
    expect(JSON.stringify(flight)).not.toContain('secret-token');
    expect(JSON.stringify(flight)).not.toContain('plain-secret-token');
  });

  it('summarizes an empty started session without fabricating activity', () => {
    const empty = runtime.startSession({
      agent: { agent_id: 'empty-flight-agent' },
      tenant_id: 'tenant-flight',
      workspace,
      profile: 'coding',
    });

    const flight = buildFlightRecorderSession(empty.session.session_id, { baseDir });

    expect(flight.summary.work_event_count).toBe(1);
    expect(flight.summary.execution_count).toBe(0);
    expect(flight.summary.prevented_count).toBe(0);
    expect(flight.summary.evidence_count).toBe(0);
    expect(flight.timeline).toHaveLength(1);
  });

  it('exports bounded JSON without file bodies or full process output claims', () => {
    const bundle = exportFlightRecorderSession(handle.session.session_id, { baseDir });

    expect(bundle.export_type).toBe('safeloop.flight_recorder.session');
    expect(bundle.includes_file_bodies).toBe(false);
    expect(bundle.includes_full_process_output).toBe(false);
    expect(bundle.timeline[0]?.explanation.toLowerCase()).toContain('session');
  });

  it('lists sessions deterministically with bounded pagination metadata', () => {
    const second = runtime.startSession({
      agent: { agent_id: 'flight-agent-2' },
      tenant_id: 'tenant-flight',
      workspace,
      profile: 'coding',
    });

    const firstPage = listFlightRecorderSessions({ baseDir }, { limit: 1 });
    expect(firstPage.sessions).toHaveLength(1);
    expect(firstPage.page.total_count).toBe(2);
    expect(firstPage.page.has_more).toBe(true);

    const secondPage = listFlightRecorderSessions({ baseDir }, { limit: 1, cursor: firstPage.page.next_cursor });
    expect(secondPage.sessions).toHaveLength(1);
    expect(new Set([...firstPage.sessions, ...secondPage.sessions].map((session) => session.session_id)).size).toBe(2);
    expect([handle.session.session_id, second.session.session_id]).toEqual(expect.arrayContaining([
      firstPage.sessions[0].session_id,
      secondPage.sessions[0].session_id,
    ]));
  });
});
