import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { buildFlightRecorderSession, exportFlightRecorderSession, listFlightRecorderSessions, redactFlightRecorderValue } from '../src/runtime/flightRecorder';
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

  it('redacts Flight Recorder evidence, artifact, memory, and export projection metadata', () => {
    const safeloopDir = join(baseDir, '.safeloop');
    mkdirSync(safeloopDir, { recursive: true });
    const sessionId = 'privacy-session';
    const timestamp = '2026-08-15T00:00:00.000Z';
    const canaries = [
      'SAFELOOP_SECRET_APIKEY_01',
      'SAFELOOP_SECRET_BEARER_02',
      'SAFELOOP_SECRET_PASSWORD_03',
      'SAFELOOP_SECRET_PRIVATEKEY_04',
      'SAFELOOP_SECRET_SESSION_05',
    ];
    const workEvent = createRuntimeWorkEvent({
      type: 'evidence.recorded',
      id: 'privacy-evidence-event',
      timestamp,
      session_id: sessionId,
      task_id: 'privacy-task',
      agent_id: 'privacy-agent',
      tenant_id: 'privacy-tenant',
      evidence_ids: ['privacy-evidence'],
      artifact_ids: ['privacy-artifact'],
      data: {
        nested: { api_key: canaries[0], array: [{ token: canaries[1] }] },
      },
    });
    appendEvent({
      id: 'privacy-legacy-event',
      type: 'evidence.recorded',
      agentId: 'privacy-agent',
      sessionId,
      summary: 'legacy detail Authorization: Bearer SAFELOOP_SECRET_BEARER_02',
      timestamp,
      metadata: {
        detail: { password: canaries[2], nested: { private_key: canaries[3] } },
        workEvent,
      },
    }, { baseDir });
    writeFileSync(join(safeloopDir, 'evidence-registry.json'), JSON.stringify({
      version: 1,
      records: [{
        evidenceId: 'privacy-evidence',
        artifactHash: 'privacy-hash',
        provenance: {
          evidenceId: 'privacy-evidence',
          type: 'privacy',
          source: 'test',
          timestamp,
          producingAgent: 'privacy-agent',
          confidence: 1,
          supportedClaim: `Bearer ${canaries[1]} password=${canaries[2]}`,
          provenance: { nested: { api_key: canaries[0] }, array: [{ private_key: canaries[3] }] },
          verificationStatus: 'VERIFIED_FACT',
        },
        verificationStatus: 'VERIFIED_FACT',
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
    }), 'utf8');
    writeFileSync(join(safeloopDir, 'runtime-artifacts.json'), JSON.stringify({
      version: 1,
      records: [{
        protocol_version: 'safeloop.runtime.v1',
        artifact_id: 'privacy-artifact',
        path: `/tmp/password=${canaries[2]}/Bearer-${canaries[1]}/file.txt`,
        content_hash: 'privacy-hash',
        operation: 'write',
        agent_id: 'privacy-agent',
        task_id: 'privacy-task',
        tenant_id: 'privacy-tenant',
        recorded_at: timestamp,
      }],
    }), 'utf8');
    writeFileSync(join(safeloopDir, 'runtime-memory.json'), JSON.stringify({
      version: 1,
      records: [{
        candidate: {
          memory_id: 'privacy-memory',
          memory_type: 'procedural',
          situation: 'privacy',
          lesson: 'privacy',
          confidence: 0.9,
          evidence: ['privacy-evidence'],
          source_artifacts: ['privacy-artifact'],
          session_id: sessionId,
          provenance: `secret=${canaries[4]}`,
        },
        provenance: {
          memory_id: 'privacy-memory',
          status: 'ACTIVE',
          decision: 'ALLOW',
          confidence: 0.9,
          evidence_ids: ['privacy-evidence'],
          artifact_ids: ['privacy-artifact'],
          originating_task: 'privacy-task',
        },
      }],
    }), 'utf8');

    const flight = buildFlightRecorderSession(sessionId, { baseDir });
    const exported = exportFlightRecorderSession(sessionId, { baseDir });
    const combined = JSON.stringify({ flight, exported });

    for (const canary of canaries) expect(combined).not.toContain(canary);
    expect(combined).toContain('[REDACTED');
  });

  it('does not count a governance block as prevented when linked execution occurred', () => {
    const sessionId = 'conflict-session';
    const denied = createRuntimeWorkEvent({
      type: 'decision.recorded',
      id: 'conflict-deny',
      timestamp: '2026-08-15T00:00:00.000Z',
      session_id: sessionId,
      task_id: 'conflict-task',
      agent_id: 'conflict-agent',
      tenant_id: 'conflict-tenant',
      proposal_id: 'conflict-proposal',
      decision_id: 'conflict-decision',
      data: { disposition: 'DENY', reason: 'denied before execution' },
    });
    const executed = createRuntimeWorkEvent({
      type: 'execution.completed',
      id: 'conflict-execution-completed',
      timestamp: '2026-08-15T00:00:01.000Z',
      session_id: sessionId,
      task_id: 'conflict-task',
      agent_id: 'conflict-agent',
      tenant_id: 'conflict-tenant',
      proposal_id: 'conflict-proposal',
      decision_id: 'conflict-decision',
      execution_id: 'conflict-execution',
      data: { status: 'EXECUTED' },
    });
    appendWorkEvent(denied);
    appendWorkEvent(executed);

    const flight = buildFlightRecorderSession(sessionId, { baseDir });

    expect(flight.summary.prevented_count).toBe(0);
    expect(flight.prevented_actions).toHaveLength(0);
    expect(flight.prevention_conflicts).toEqual([expect.objectContaining({
      blocked_event_id: 'conflict-deny',
      execution_event_ids: ['conflict-execution-completed'],
      execution_occurred: true,
    })]);
  });

  it('preserves path structure while redacting realistic secret assignments idempotently', () => {
    const input = {
      artifact: {
        path: '/tmp/password=opensesame/report.txt',
        windows: 'C:\\safe\\credential=winSecret99\\report.txt',
        multi: '/home/api_key=abc123XYZ/client_secret=shh-987/data.json',
        filename: '/tmp/report-token=tok_12345.txt',
        ordinary: '/tmp/password_policy/tokenization/private_key_rotation_required.txt',
      },
      text: [
        'Authorization: Bearer bearer-value-123',
        'Bearer standalone-token-123',
        'password=opensesame/report.txt',
        'passwd: hunter2!',
        'api_key = sk-live-abcdefghijklmnopqrstuvwxyz',
        'apikey=plainapikey123',
        'client_secret=secret.with-punctuation_123',
        'secret=topsecret99',
        'credential: cred-value-123',
        'authorization = signed-token-123',
        'operator=operator-credential-123',
        'aws_secret_access_key=aws-secret-value-123',
        'connect https://user:supersecret@example.com/private',
      ],
      nested: [{ metadata: { proof: { before: { token: 'structured-token-123' } } } }],
      operator: 'structured-operator-secret',
    };

    const once = redactFlightRecorderValue(input);
    const twice = redactFlightRecorderValue(once);
    const rendered = JSON.stringify(once);

    expect(twice).toEqual(once);
    expect(rendered).toContain('/tmp/password=[REDACTED]/report.txt');
    expect(rendered).toContain('C:\\\\safe\\\\credential=[REDACTED]\\\\report.txt');
    expect(rendered).toContain('/home/api_key=[REDACTED]/client_secret=[REDACTED]/data.json');
    expect(rendered).toContain('/tmp/report-token=[REDACTED]');
    expect(rendered).toContain('/tmp/password_policy/tokenization/private_key_rotation_required.txt');
    for (const leaked of [
      'opensesame', 'winSecret99', 'abc123XYZ', 'shh-987', 'tok_12345', 'bearer-value-123',
      'standalone-token-123', 'hunter2', 'sk-live-abcdefghijklmnopqrstuvwxyz', 'plainapikey123',
      'secret.with-punctuation_123', 'topsecret99', 'cred-value-123', 'signed-token-123',
      'operator-credential-123', 'aws-secret-value-123', 'supersecret', 'structured-token-123',
      'structured-operator-secret',
    ]) expect(rendered).not.toContain(leaked);
    expect(rendered).not.toContain('[REDACTED] api key]');
  });

  it('keeps prevention certainty and temporal conflicts truthful without fabricated same-session linkage', () => {
    const sessionId = 'temporal-prevention-session';
    const common = {
      session_id: sessionId,
      task_id: 'temporal-task',
      agent_id: 'temporal-agent',
      tenant_id: 'temporal-tenant',
    };
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'decision.recorded',
      id: 'block-then-execute-deny',
      timestamp: '2026-08-15T00:00:00.000Z',
      proposal_id: 'proposal-after',
      decision_id: 'decision-after',
      data: { disposition: 'DENY', reason: 'block then linked execution credential=temporal-secret-1' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'execution.completed',
      id: 'block-then-execute-completed',
      timestamp: '2026-08-15T00:00:01.000Z',
      proposal_id: 'proposal-after',
      decision_id: 'decision-after',
      execution_id: 'execution-after',
      data: { status: 'EXECUTED' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'execution.completed',
      id: 'execute-before-block-completed',
      timestamp: '2026-08-15T00:00:02.000Z',
      proposal_id: 'proposal-before',
      decision_id: 'decision-before',
      execution_id: 'execution-before',
      data: { status: 'EXECUTED' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'decision.recorded',
      id: 'execute-before-block-deny',
      timestamp: '2026-08-15T00:00:03.000Z',
      proposal_id: 'proposal-before',
      decision_id: 'decision-before',
      data: { disposition: 'DENY', reason: 'later block for a subsequent attempt' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'execution.completed',
      id: 'same-session-unrelated-execution',
      timestamp: '2026-08-15T00:00:04.000Z',
      proposal_id: 'proposal-unrelated',
      decision_id: 'decision-unrelated',
      execution_id: 'execution-unrelated',
      data: { status: 'EXECUTED' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'decision.recorded',
      id: 'dangling-causal-deny',
      timestamp: '2026-08-15T00:00:05.000Z',
      proposal_id: 'proposal-dangling',
      decision_id: 'decision-dangling',
      causes: ['missing-proposal-event'],
      data: { disposition: 'DENY', reason: 'missing causal reference' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'decision.recorded',
      id: 'same-time-deny',
      timestamp: '2026-08-15T00:00:06.000Z',
      proposal_id: 'proposal-same-time',
      decision_id: 'decision-same-time',
      data: { disposition: 'DENY', reason: 'same timestamp link' },
    }));
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'execution.started',
      id: 'same-time-started',
      timestamp: '2026-08-15T00:00:06.000Z',
      proposal_id: 'proposal-same-time',
      decision_id: 'decision-same-time',
      execution_id: 'execution-same-time',
      data: { status: 'STARTED' },
    }));

    const flight = buildFlightRecorderSession(sessionId, { baseDir });

    expect(flight.prevention_conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blocked_event_id: 'block-then-execute-deny',
        execution_event_ids: ['block-then-execute-completed'],
        execution_status: 'observed',
        temporal_status: 'after_block',
      }),
      expect.objectContaining({
        blocked_event_id: 'same-time-deny',
        execution_event_ids: ['same-time-started'],
        execution_status: 'unknown',
        temporal_status: 'same_time_or_unknown',
      }),
    ]));
    expect(flight.prevention_conflicts.some((conflict) => conflict.blocked_event_id === 'execute-before-block-deny')).toBe(false);
    expect(flight.prevention_conflicts.some((conflict) => conflict.execution_event_ids.includes('same-session-unrelated-execution'))).toBe(false);
    expect(flight.prevented_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_id: 'execute-before-block-deny', execution_status: 'not_observed' }),
      expect.objectContaining({ event_id: 'dangling-causal-deny', execution_status: 'unknown' }),
    ]));
    expect(flight.prevented_actions.find((entry) => entry.event_id === 'dangling-causal-deny')?.uncertainty_reason)
      .toContain('missing-proposal-event');
    expect(flight.summary.prevented_count).toBe(2);
    expect(JSON.stringify(flight)).not.toContain('temporal-secret-1');
  });

  it('deduplicates prevented actions at action level under certainty semantics', () => {
    const sessionId = 'prevented-count-session';
    const common = {
      session_id: sessionId,
      task_id: 'count-task',
      agent_id: 'count-agent',
      tenant_id: 'count-tenant',
    };
    for (const [index, id] of ['one-a', 'one-b', 'one-c'].entries()) {
      appendWorkEvent(createRuntimeWorkEvent({
        ...common,
        type: 'decision.recorded',
        id,
        timestamp: `2026-08-15T00:01:0${index}.000Z`,
        proposal_id: 'proposal-one',
        action_fingerprint: 'fingerprint-one',
        decision_id: `decision-${id}`,
        data: { disposition: 'DENY', reason: `duplicate block ${index}` },
      }));
    }
    appendWorkEvent(createRuntimeWorkEvent({
      ...common,
      type: 'decision.recorded',
      id: 'two-a',
      timestamp: '2026-08-15T00:01:10.000Z',
      proposal_id: 'proposal-two',
      decision_id: 'decision-two',
      data: { disposition: 'DENY', reason: 'separate action' },
    }));

    const flight = buildFlightRecorderSession(sessionId, { baseDir });

    expect(flight.summary.prevented_count).toBe(2);
    expect(flight.prevented_actions.map((entry) => entry.event_id)).toEqual(['one-a', 'two-a']);
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
