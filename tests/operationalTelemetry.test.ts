import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { buildOperationalTelemetry, prometheusText, recordTelemetry } from '../src/runtime/operationalTelemetry';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { createRuntimeWorkEvent } from '../src/runtime/workEvents';
import { startDaemon, type RunningDaemon } from '../src/runtime/daemon';

let baseDir: string;
let workspace: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-operational-telemetry-'));
  workspace = mkdtempSync(join(tmpdir(), 'safeloop-operational-workspace-'));
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
  handle = runtime.startSession({
    agent: { agent_id: 'telemetry-agent', agent_name: 'Telemetry Agent' },
    tenant_id: 'tenant-telemetry',
    workspace,
    profile: 'coding',
  });
  taskId = runtime.startTask(handle.credential, {
    session_id: handle.session.session_id,
    goal: 'exercise operational telemetry',
  }).task_id;
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function appendWorkEvent(event: ReturnType<typeof createRuntimeWorkEvent>): void {
  appendEvent({
    id: `telemetry-${event.id}`,
    type: event.type,
    agentId: event.agent_id ?? 'telemetry-agent',
    sessionId: event.session_id,
    summary: event.summary ?? event.type,
    timestamp: event.timestamp,
    metadata: { workEvent: event },
  }, { baseDir });
}

async function exerciseGoldenSet(): Promise<void> {
  const action = {
    action_kind: 'filesystem' as const,
    operation: 'create',
    target: join(workspace, 'telemetry.txt'),
    arguments: { content: 'telemetry proof' },
    agent_id: 'telemetry-agent',
  };
  const decision = runtime.propose(handle.credential, { session_id: handle.session.session_id, task_id: taskId, action });
  expect(decision.allowed).toBe(true);
  const result = await runtime.execute(handle.credential, { session_id: handle.session.session_id, task_id: taskId, permit: decision.execution_permit, action } as never);
  expect(result.status).toBe('EXECUTED');
  expect(existsSync(join(workspace, 'telemetry.txt'))).toBe(true);

  appendWorkEvent(createRuntimeWorkEvent({
    type: 'decision.recorded',
    id: 'synthetic-deny',
    timestamp: new Date(Date.parse(handle.session.started_at) + 10_000).toISOString(),
    session_id: handle.session.session_id,
    task_id: taskId,
    agent_id: 'telemetry-agent',
    tenant_id: 'tenant-telemetry',
    data: { disposition: 'DENY', reason: 'known forbidden destructive action' },
  }));
  appendWorkEvent(createRuntimeWorkEvent({
    type: 'approval.denied',
    id: 'synthetic-approval-denied',
    timestamp: new Date(Date.parse(handle.session.started_at) + 11_000).toISOString(),
    session_id: handle.session.session_id,
    task_id: taskId,
    agent_id: 'telemetry-agent',
    tenant_id: 'tenant-telemetry',
    data: { reason: 'operator denied' },
  }));
  appendWorkEvent(createRuntimeWorkEvent({
    type: 'execution.rejected',
    id: 'synthetic-budget-block',
    timestamp: new Date(Date.parse(handle.session.started_at) + 12_000).toISOString(),
    session_id: handle.session.session_id,
    task_id: taskId,
    agent_id: 'telemetry-agent',
    tenant_id: 'tenant-telemetry',
    data: { status: 'BUDGET_EXHAUSTED', reason: 'budget exhausted before execution' },
  }));
}

describe('operational telemetry model', () => {
  it('distinguishes liveness, readiness, governance, evidence, dependencies, telemetry, and synthetic controls', async () => {
    await exerciseGoldenSet();
    const snapshot = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });

    expect(snapshot.health.liveness.status).toBe('healthy');
    expect(snapshot.health.readiness.status).toBe('healthy');
    expect(snapshot.health.governance.status).toBe('healthy');
    expect(snapshot.health.evidence.status).toBe('healthy');
    expect(snapshot.health.dependencies.map((entry) => entry.component)).toEqual(expect.arrayContaining([
      'policy_profile_loader',
      'approval_permit_authority',
      'managed_execution_adapter',
      'evidence_store',
      'telemetry_exporter',
    ]));
    expect(snapshot.health.telemetry.status).toBe('healthy');
    expect(snapshot.synthetic.positive_controls.every((entry) => entry.status === 'pass')).toBe(true);
    expect(snapshot.synthetic.negative_controls.every((entry) => entry.status === 'pass')).toBe(true);
    expect(snapshot.synthetic.drift_detected).toBe(false);
  });

  it('exports bounded governance, execution, evidence, and saturation metrics without high-cardinality labels', async () => {
    await exerciseGoldenSet();
    const snapshot = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });

    expect(snapshot.metrics.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'safeloop_governance_decisions_total',
      'safeloop_managed_executions_total',
      'safeloop_evidence_verification_total',
      'safeloop_active_sessions',
      'safeloop_pending_approvals',
    ]));
    for (const metric of snapshot.metrics) {
      expect(Object.keys(metric.labels ?? {})).not.toEqual(expect.arrayContaining(['session_id', 'event_id', 'task_id', 'artifact_path', 'prompt']));
    }
    expect(snapshot.privacy.high_cardinality_metric_risk_found).toBe(false);
    expect(prometheusText(snapshot)).toContain('safeloop_synthetic_control_status{polarity="positive"} 1');
  });

  it('redacts credential canaries from health and metric output', async () => {
    appendWorkEvent(createRuntimeWorkEvent({
      type: 'decision.recorded',
      id: 'secret-canary-deny',
      timestamp: new Date().toISOString(),
      session_id: handle.session.session_id,
      task_id: taskId,
      agent_id: 'telemetry-agent',
      tenant_id: 'tenant-telemetry',
      data: {
        disposition: 'DENY',
        reason: 'Authorization: Bearer raw-secret password=hunter2 api_key=sk-live credential=abc client_secret=def aws_secret_access_key=ghi https://user:pass@example.com -----BEGIN PRIVATE KEY-----',
      },
    }));

    const snapshot = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-live');
    expect(serialized).not.toContain('user:pass@example.com');
    expect(snapshot.privacy.telemetry_contains_raw_credentials).toBe(false);
  });

  it('classifies degraded components without changing governance results', async () => {
    const before = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: { action_kind: 'filesystem', operation: 'create', target: join(workspace, 'before.txt'), arguments: { content: 'before' }, agent_id: 'telemetry-agent' },
    });
    const degraded = buildOperationalTelemetry(runtime.status(), {
      storageOptions: { baseDir },
      force: { telemetryExporterFailure: true, optionalProviderUnavailable: true },
    });
    const after = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: { action_kind: 'filesystem', operation: 'create', target: join(workspace, 'after.txt'), arguments: { content: 'after' }, agent_id: 'telemetry-agent' },
    });

    expect(degraded.health.telemetry.status).toBe('degraded');
    expect(degraded.health.dependencies.find((entry) => entry.component === 'optional_provider')?.status).toBe('degraded');
    expect(after.disposition).toBe(before.disposition);
    expect(after.allowed).toBe(before.allowed);
  });

  it('surfaces unhealthy policy and evidence failure injection conservatively', () => {
    const policy = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir }, force: { policyUnavailable: true } });
    const evidence = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir }, force: { evidenceFailure: true } });

    expect(policy.health.governance.status).toBe('unhealthy');
    expect(policy.health.readiness.status).toBe('unhealthy');
    expect(evidence.health.evidence.status).toBe('unhealthy');
  });

  it('detects synthetic drift when controls have not exercised the required governance paths', () => {
    const snapshot = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });

    expect(snapshot.synthetic.drift_detected).toBe(true);
    expect(snapshot.synthetic.positive_controls.some((entry) => entry.status === 'fail')).toBe(true);
    expect(snapshot.synthetic.negative_controls.some((entry) => entry.status === 'fail')).toBe(true);
  });

  it('records version provenance without rewriting historic records', async () => {
    await exerciseGoldenSet();
    const first = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });
    const second = buildOperationalTelemetry({ ...runtime.status(), runtime_version: '0.2.0-test' }, { storageOptions: { baseDir } });

    expect(first.provenance.runtime_version).toBe('0.2.0');
    expect(second.provenance.runtime_version).toBe('0.2.0-test');
    expect(first.provenance.config_version).toBe(second.provenance.config_version);
  });

  it('isolates telemetry exporter failure from runtime decisions', async () => {
    await exerciseGoldenSet();
    const snapshot = buildOperationalTelemetry(runtime.status(), { storageOptions: { baseDir } });
    const result = recordTelemetry({ export: () => { throw new Error('Authorization: Bearer exporter-secret'); } }, snapshot);
    const decision = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: { action_kind: 'filesystem', operation: 'create', target: join(workspace, 'still-governed.txt'), arguments: { content: 'ok' }, agent_id: 'telemetry-agent' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('exporter-secret');
    expect(decision.allowed).toBe(true);
  });
});

describe('operational health daemon routes', () => {
  let daemon: RunningDaemon;
  let daemonBaseDir: string;
  let daemonWorkspace: string;

  beforeEach(async () => {
    daemonBaseDir = mkdtempSync(join(tmpdir(), 'safeloop-operational-daemon-'));
    daemonWorkspace = mkdtempSync(join(tmpdir(), 'safeloop-operational-daemon-workspace-'));
    daemon = await startDaemon({ storageOptions: { baseDir: daemonBaseDir }, port: 0, workspace: daemonWorkspace, defaultProfile: 'coding' });
  });

  afterEach(async () => {
    await daemon.stop();
    rmSync(daemonBaseDir, { recursive: true, force: true });
    rmSync(daemonWorkspace, { recursive: true, force: true });
  });

  it('keeps public liveness separate from authorized detailed health and metrics', async () => {
    const live = await fetch(`http://127.0.0.1:${daemon.connection.port}/health/live`);
    expect(live.status).toBe(200);
    expect((await live.json()).status).toBe('healthy');

    const unauth = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/health`);
    expect(unauth.status).toBe(401);

    const detailed = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/health`, {
      headers: { authorization: `Bearer ${daemon.connection.credential}` },
    });
    expect(detailed.status).toBe(200);
    expect((await detailed.json()).health.liveness.status).toBe('healthy');

    const metrics = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/metrics`, {
      headers: { authorization: `Bearer ${daemon.connection.credential}` },
    });
    expect(metrics.status).toBe(200);
    expect((await metrics.json()).metrics.every((entry: { labels?: Record<string, string> }) => !entry.labels?.session_id)).toBe(true);
  });
});
