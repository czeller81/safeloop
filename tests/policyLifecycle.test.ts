import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  activatePolicyBundle,
  approvePolicyBundle,
  canonicalJson,
  corruptPolicyLifecycleForTest,
  createPolicyBundle,
  detectPolicyDrift,
  ensureBaselinePolicyLifecycle,
  policyLifecycleStatus,
  readPolicyLifecycleStore,
  resolveHistoricalPolicyContext,
  rollbackPolicy,
  safePolicyDiff,
  stableHash,
  validatePolicyBundle,
  writeMalformedPolicyLifecycleForTest,
} from '../src/policyLifecycle';
import { loadProfile, type GovernanceProfile } from '../src/runtime/profiles';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { buildFlightRecorderSession } from '../src/runtime/flightRecorder';
import { buildOperationalTelemetry } from '../src/runtime/operationalTelemetry';
import { startDaemon, type RunningDaemon } from '../src/runtime/daemon';

let baseDir: string;
let workspace: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-lifecycle-'));
  workspace = mkdtempSync(join(tmpdir(), 'safeloop-policy-lifecycle-workspace-'));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function cloneProfile(id = 'coding'): GovernanceProfile {
  return JSON.parse(JSON.stringify(loadProfile(id))) as GovernanceProfile;
}

function activateVersion(version: string, profile = cloneProfile()): string {
  const bundle = createPolicyBundle({ profile, version, created_by: 'operator' }, { baseDir });
  const validation = validatePolicyBundle(bundle.bundle_id, 'operator', { baseDir });
  expect(validation.valid).toBe(true);
  approvePolicyBundle(bundle.bundle_id, 'operator', { baseDir });
  activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'operator', approved_by: 'operator', request_id: `activate:${version}` }, { baseDir });
  return bundle.bundle_id;
}

describe('policy lifecycle hashing and immutability', () => {
  it('canonical hashing is stable for reordered keys and changes for material policy changes', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it('imports an immutable active baseline and preserves old versions after activation', () => {
    const first = ensureBaselinePolicyLifecycle('coding', 'operator', { baseDir });
    const firstHash = first.active_bundle!.content_hash;
    const changed = cloneProfile();
    changed.description = `${changed.description} updated`;
    const secondId = activateVersion('v2', changed);

    const store = readPolicyLifecycleStore({ baseDir });
    const firstAgain = store.bundles.find((entry) => entry.content_hash === firstHash);
    expect(firstAgain?.content_hash).toBe(firstHash);
    expect(store.active?.bundle_id).toBe(secondId);
    expect(store.bundles.filter((entry) => entry.status === 'ACTIVE')).toHaveLength(1);
  });

  it('fails closed instead of silently switching active profiles during provenance lookup', () => {
    ensureBaselinePolicyLifecycle('coding', 'operator', { baseDir });
    expect(() => ensureBaselinePolicyLifecycle('research', 'runtime', { baseDir })).toThrow(/active_policy_profile_mismatch/);
    expect(policyLifecycleStatus({ baseDir }).active_bundle?.profile_id).toBe('coding');
  });

  it('safe diffs redact secret-like metadata values', () => {
    const a = createPolicyBundle({ profile: cloneProfile(), version: 'a', created_by: 'operator', metadata: { api_key: 'sk-live-secret' } }, { baseDir });
    const bProfile = cloneProfile();
    bProfile.budgets.maximum_actions = (bProfile.budgets.maximum_actions ?? 0) + 1;
    const b = createPolicyBundle({ profile: bProfile, version: 'b', created_by: 'operator', metadata: { api_key: 'sk-live-secret-2' } }, { baseDir });
    const diff = safePolicyDiff(a.bundle_id, b.bundle_id, { baseDir });
    expect(diff.some((entry) => entry.path.includes('budgets.maximum_actions'))).toBe(true);
    expect(JSON.stringify(diff)).not.toContain('sk-live-secret');
  });
});

describe('policy lifecycle activation, rollback, and drift', () => {
  it('rejects invalid bundles and forbidden state jumps before activation', () => {
    const profile = cloneProfile();
    profile.rules = [];
    const bundle = createPolicyBundle({ profile, version: 'invalid', created_by: 'operator' }, { baseDir });
    const validation = validatePolicyBundle(bundle.bundle_id, 'operator', { baseDir });
    expect(validation.valid).toBe(false);
    expect(() => activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'operator', approved_by: 'operator' }, { baseDir }))
      .toThrow(/policy_validation_failed|policy_bundle_not_approved/);
    expect(policyLifecycleStatus({ baseDir }).active_bundle).toBeUndefined();
  });

  it('activation is atomic on injected persistence failure and idempotent on retry', () => {
    const v1 = activateVersion('v1');
    const profile = cloneProfile();
    profile.description = 'candidate v2';
    const bundle = createPolicyBundle({ profile, version: 'v2', created_by: 'operator' }, { baseDir });
    validatePolicyBundle(bundle.bundle_id, 'operator', { baseDir });
    approvePolicyBundle(bundle.bundle_id, 'operator', { baseDir });
    expect(() => activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'operator', approved_by: 'operator', fail_after_validation: true }, { baseDir }))
      .toThrow(/activation_persistence_failed/);
    expect(policyLifecycleStatus({ baseDir }).active_bundle?.bundle_id).toBe(v1);
    const first = activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'operator', approved_by: 'operator', request_id: 'same-request' }, { baseDir });
    const second = activatePolicyBundle({ bundle_id: bundle.bundle_id, actor: 'operator', approved_by: 'operator', request_id: 'same-request' }, { baseDir });
    expect(second.activation_id).toBe(first.activation_id);
    expect(readPolicyLifecycleStore({ baseDir }).bundles.filter((entry) => entry.status === 'ACTIVE')).toHaveLength(1);
  });

  it('rollback activates a previous version while preserving history', () => {
    const v1 = activateVersion('v1');
    const changed = cloneProfile();
    changed.description = 'v2 changed policy text';
    const v2 = activateVersion('v2', changed);
    const rollback = rollbackPolicy({ target_bundle_id: v1, actor: 'operator', approved_by: 'operator', reason: 'incident rollback' }, { baseDir });
    const store = readPolicyLifecycleStore({ baseDir });

    expect(policyLifecycleStatus({ baseDir }).active_bundle?.bundle_id).toBe(v1);
    expect(rollback.rollback_from_bundle_id).toBe(v2);
    expect(store.activations.map((entry) => entry.bundle_id)).toEqual(expect.arrayContaining([v1, v2]));
    expect(store.events.map((entry) => entry.type)).toEqual(expect.arrayContaining(['policy.rollback.initiated', 'policy.rollback.completed']));
  });

  it('detects policy and config drift plus malformed startup state', () => {
    const v1 = activateVersion('v1');
    expect(detectPolicyDrift({ baseDir }).state).toBe('NO_DRIFT');
    corruptPolicyLifecycleForTest((store) => {
      store.bundles.find((entry) => entry.bundle_id === v1)!.content_hash = 'sha256:tampered';
    }, { baseDir });
    expect(detectPolicyDrift({ baseDir })).toMatchObject({ state: 'DRIFT' });

    writeMalformedPolicyLifecycleForTest('{"schema_version":999,"bundles":[]}', { baseDir });
    expect(detectPolicyDrift({ baseDir }).state).toBe('UNKNOWN');
  });
});

describe('decision provenance and in-flight semantics', () => {
  let runtime: SafeloopRuntime;
  let handle: SessionHandle;
  let taskId: string;

  beforeEach(() => {
    runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
    handle = runtime.startSession({ agent: { agent_id: 'policy-agent' }, tenant_id: 'tenant-policy', workspace, profile: 'coding' });
    taskId = runtime.startTask(handle.credential, { session_id: handle.session.session_id, goal: 'policy provenance' }).task_id;
  });

  it('binds decisions and permit events to immutable policy/config provenance', async () => {
    const decision = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: { action_kind: 'filesystem', operation: 'create', target: join(workspace, 'a.txt'), arguments: { content: 'a' }, agent_id: 'policy-agent' },
    });
    expect(decision.policy_provenance?.policy_bundle_id).toBeTruthy();
    expect(decision.execution_permit?.policy_provenance?.config_snapshot_id).toBe(decision.policy_provenance?.config_snapshot_id);
    const context = resolveHistoricalPolicyContext(decision.policy_provenance!, { baseDir });
    expect(context.bundle.content_hash).toBe(decision.policy_provenance?.policy_hash);

    await runtime.execute(handle.credential, { session_id: handle.session.session_id, permit: decision.execution_permit, action: { action_kind: 'filesystem', operation: 'create', target: join(workspace, 'a.txt'), arguments: { content: 'a' }, agent_id: 'policy-agent' } });
    const flight = buildFlightRecorderSession(handle.session.session_id, { baseDir });
    expect(JSON.stringify(flight)).toContain(decision.policy_provenance!.policy_bundle_id);
  });

  it('keeps held approval execution bound to proposal-time policy after later activation', async () => {
    const held = runtime.propose(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      action: { action_kind: 'filesystem', operation: 'create', target: join(tmpdir(), 'policy-outside.txt'), arguments: { content: 'outside' }, agent_id: 'policy-agent' },
    });
    expect(held.requires_approval).toBe(true);
    const original = held.policy_provenance!;
    const changed = cloneProfile();
    changed.description = 'new policy activated while approval is pending';
    activateVersion('post-held', changed);
    const grant = runtime.grantApproval({ approval_request_id: held.approval_request!.approval_request_id, approver: 'operator' });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id,
      task_id: taskId,
      token: grant.token,
      action: { action_kind: 'filesystem', operation: 'create', target: join(tmpdir(), 'policy-outside.txt'), arguments: { content: 'outside' }, agent_id: 'policy-agent' },
    });
    expect(redemption.redeemed).toBe(true);
    expect(redemption.execution_permit?.policy_provenance?.policy_bundle_id).toBe(original.policy_bundle_id);
  });
});

describe('policy lifecycle daemon authorization and telemetry', () => {
  let daemon: RunningDaemon;
  let daemonBaseDir: string;
  let daemonWorkspace: string;

  beforeEach(async () => {
    daemonBaseDir = mkdtempSync(join(tmpdir(), 'safeloop-policy-daemon-'));
    daemonWorkspace = mkdtempSync(join(tmpdir(), 'safeloop-policy-daemon-workspace-'));
    daemon = await startDaemon({ storageOptions: { baseDir: daemonBaseDir }, port: 0, workspace: daemonWorkspace, defaultProfile: 'coding' });
  });

  afterEach(async () => {
    await daemon.stop();
    rmSync(daemonBaseDir, { recursive: true, force: true });
    rmSync(daemonWorkspace, { recursive: true, force: true });
  });

  it('requires operator authorization for lifecycle mutation routes and exposes read status to runtime auth', async () => {
    const unauth = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/policy/import-baseline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.connection.credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'coding' }),
    });
    expect(unauth.status).toBe(401);

    const statusBefore = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/policy/status`, {
      headers: { authorization: `Bearer ${daemon.connection.credential}` },
    });
    expect(statusBefore.status).toBe(200);
  });

  it('redacts secret-like metadata in policy list and show routes', async () => {
    const operator = JSON.parse(readFileSync(daemon.operatorCredentialPath, 'utf8')) as { credential: string };
    const create = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/policy/create`, {
      method: 'POST',
      headers: { authorization: `Bearer ${operator.credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'coding', version: 'api-redaction', metadata: { api_key: 'sk-live-route-secret', note: 'password=hunter2' } }),
    });
    expect(create.status).toBe(200);
    const created = await create.json() as { bundle_id: string };

    const list = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/policy/list`, {
      headers: { authorization: `Bearer ${daemon.connection.credential}` },
    });
    const show = await fetch(`http://127.0.0.1:${daemon.connection.port}/v1/policy/show`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.connection.credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ bundle_id: created.bundle_id }),
    });
    expect(list.status).toBe(200);
    expect(show.status).toBe(200);
    const serialized = `${JSON.stringify(await list.json())}${JSON.stringify(await show.json())}`;
    expect(serialized).not.toContain('sk-live-route-secret');
    expect(serialized).not.toContain('hunter2');
  });
});

describe('policy lifecycle health integration and secret safety', () => {
  it('surfaces lifecycle drift in telemetry without leaking secret canaries', () => {
    const status = ensureBaselinePolicyLifecycle('coding', 'operator', { baseDir });
    expect(status.drift_state).toBe('NO_DRIFT');
    corruptPolicyLifecycleForTest((store) => {
      store.bundles[0].metadata = {
        note: 'Authorization: Bearer raw-secret password=hunter2 api_key=sk-live client_secret=abc aws_secret_access_key=def -----BEGIN PRIVATE KEY-----',
      };
    }, { baseDir });
    const snapshot = buildOperationalTelemetry({
      protocol_version: 'safeloop.runtime.v1',
      runtime_version: '0.2.0',
      started_at: new Date().toISOString(),
      active_sessions: 0,
      sessions: [],
    }, { storageOptions: { baseDir } });
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.policy_lifecycle?.drift_state).toBe('NO_DRIFT');
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-live');
  });
});
