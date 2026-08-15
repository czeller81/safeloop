import { createHash } from 'crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { appendEvent } from './eventStream';
import { ensureParentDir, readJsonFile, resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';
import { redactSecrets } from './runtime/redaction';
import { canonicalizeAction } from './runtime/canonicalAction';
import { evaluateProfile, loadProfile, validateProfile, type GovernanceProfile } from './runtime/profiles';
import { PROTOCOL_VERSION, type ActionProposal, type RuntimeDispositionCode } from './runtime/protocol';

export type PolicyLifecycleState =
  | 'DRAFT'
  | 'VALIDATED'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'RETIRED'
  | 'REJECTED'
  | 'INVALID'
  | 'ROLLED_BACK';

export type PolicyDriftState = 'NO_DRIFT' | 'DRIFT' | 'UNKNOWN';

export interface PolicyBundle {
  schema_version: 1;
  bundle_id: string;
  version: string;
  profile_id: string;
  created_at: string;
  created_by: string;
  content_hash: string;
  status: PolicyLifecycleState;
  profile: GovernanceProfile;
  metadata: Record<string, unknown>;
  tenant_id?: string;
}

export interface GovernanceConfigSnapshot {
  schema_version: 1;
  snapshot_id: string;
  version: string;
  policy_bundle_id: string;
  policy_bundle_version: string;
  policy_hash: string;
  profile_id: string;
  runtime_version: string;
  protocol_version: string;
  event_schema_version: 1;
  content_hash: string;
  status: PolicyLifecycleState;
  created_at: string;
  created_by: string;
  content: {
    profile_id: string;
    policy_bundle_id: string;
    policy_bundle_version: string;
    policy_hash: string;
    budgets: GovernanceProfile['budgets'];
    managed_paths: GovernanceProfile['managed_paths'];
    memory_write_policy: GovernanceProfile['memory_write_policy'];
    minimum_memory_confidence: number;
    runtime_controls: GovernanceProfile['runtime_controls'];
    launch_environment_policy: {
      set_names: string[];
      unset_names: string[];
      rationale?: string;
    };
    adapter_versions: Record<string, string>;
    feature_flags: Record<string, boolean>;
    model_provider: { provider?: string; model?: string };
    schema_versions: { protocol: string; event_model: 1; policy_bundle: 1; config_snapshot: 1 };
  };
  tenant_id?: string;
}

export interface PolicyActivationRecord {
  activation_id: string;
  request_id: string;
  bundle_id: string;
  bundle_version: string;
  config_snapshot_id: string;
  previous_bundle_id?: string;
  previous_config_snapshot_id?: string;
  actor: string;
  approved_by: string;
  approved_at: string;
  activated_at: string;
  validation_id: string;
  golden_controls_passed: boolean;
  reason?: string;
  rollback_from_bundle_id?: string;
}

export interface PolicyLifecycleEvent {
  id: string;
  type:
    | 'policy.bundle.created'
    | 'policy.bundle.validated'
    | 'policy.bundle.validation_failed'
    | 'policy.bundle.approved'
    | 'policy.bundle.rejected'
    | 'policy.bundle.activated'
    | 'policy.bundle.activation_failed'
    | 'policy.bundle.superseded'
    | 'policy.rollback.initiated'
    | 'policy.rollback.completed'
    | 'policy.drift.detected'
    | 'policy.drift.cleared';
  timestamp: string;
  actor: string;
  bundle_id?: string;
  bundle_version?: string;
  config_snapshot_id?: string;
  previous_bundle_id?: string;
  previous_config_snapshot_id?: string;
  tenant_id?: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface PolicyValidationResult {
  validation_id: string;
  bundle_id: string;
  bundle_version: string;
  validated_at: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  golden_controls: GoldenPolicyControlsResult;
}

export interface GoldenPolicyControlResult {
  id: string;
  polarity: 'positive' | 'negative';
  expected: RuntimeDispositionCode[];
  observed: RuntimeDispositionCode;
  status: 'pass' | 'fail';
}

export interface GoldenPolicyControlsResult {
  positive_pass: boolean;
  negative_pass: boolean;
  controls: GoldenPolicyControlResult[];
}

export interface PolicyLifecycleStore {
  schema_version: 1;
  bundles: PolicyBundle[];
  config_snapshots: GovernanceConfigSnapshot[];
  active?: {
    bundle_id: string;
    config_snapshot_id: string;
    activated_at: string;
    activation_id: string;
  };
  activations: PolicyActivationRecord[];
  validations: PolicyValidationResult[];
  events: PolicyLifecycleEvent[];
  idempotency: Record<string, string>;
}

export interface PolicyDecisionProvenance {
  policy_bundle_id: string;
  policy_bundle_version: string;
  policy_hash: string;
  config_snapshot_id: string;
  config_hash: string;
  runtime_version: string;
  protocol_version: string;
  event_schema_version: 1;
  profile: string;
}

export interface PolicyLifecycleStatus {
  active_bundle?: PolicyBundle;
  active_config?: GovernanceConfigSnapshot;
  drift_state: PolicyDriftState;
  drift_reasons: string[];
  latest_validation?: PolicyValidationResult;
  latest_activation?: PolicyActivationRecord;
  bundle_count: number;
  config_snapshot_count: number;
}

const STORE_FILE = 'policy-lifecycle.json';
const SUPPORTED_SCHEMA_VERSION = 1;
const POLICY_RUNTIME_VERSION = '0.2.0';
const SECRET_KEYS = /(?:password|secret|credential|api[_-]?key|authorization|private[_-]?key|client_secret|operator|bearer|access[_-]?key|auth[_-]?token|session[_-]?token|token[_-]?value)/i;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function stableHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]));
}

function now(): string {
  return new Date().toISOString();
}

function lifecyclePath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath(STORE_FILE, options);
}

function emptyStore(): PolicyLifecycleStore {
  return { schema_version: 1, bundles: [], config_snapshots: [], activations: [], validations: [], events: [], idempotency: {} };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactSecrets(value) : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key)) {
      out[`${key.replace(/value$/i, '')}_ref`] = typeof entry === 'string' && entry ? `secret-ref:${stableHash(entry).slice(7, 19)}` : '[REDACTED]';
    } else {
      out[key] = sanitize(entry);
    }
  }
  return out;
}

export function redactPolicyLifecycleValue<T>(value: T): T {
  return sanitize(value) as T;
}

function readStore(options: SafeloopStorageOptions = {}): PolicyLifecycleStore {
  const parsed = readJsonFile<PolicyLifecycleStore>(lifecyclePath(options), emptyStore());
  if (parsed.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`unsupported policy lifecycle schema version: ${String((parsed as { schema_version?: unknown }).schema_version)}`);
  }
  return {
    ...emptyStore(),
    ...parsed,
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
    config_snapshots: Array.isArray(parsed.config_snapshots) ? parsed.config_snapshots : [],
    activations: Array.isArray(parsed.activations) ? parsed.activations : [],
    validations: Array.isArray(parsed.validations) ? parsed.validations : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    idempotency: parsed.idempotency && typeof parsed.idempotency === 'object' ? parsed.idempotency : {},
  };
}

function writeStoreAtomic(store: PolicyLifecycleStore, options: SafeloopStorageOptions = {}): void {
  const path = lifecyclePath(options);
  ensureParentDir(path);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function recordLifecycleEvent(store: PolicyLifecycleStore, input: Omit<PolicyLifecycleEvent, 'id' | 'timestamp'>, options: SafeloopStorageOptions): void {
  const event: PolicyLifecycleEvent = {
    id: `policy-event-${Date.now()}-${createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 10)}`,
    timestamp: now(),
    ...input,
    detail: input.detail ? sanitize(input.detail) as Record<string, unknown> : undefined,
  };
  store.events.push(event);
  appendEvent({
    id: event.id,
    type: event.type,
    agentId: event.actor,
    summary: event.summary,
    timestamp: event.timestamp,
    metadata: {
      policyLifecycle: true,
      bundleId: event.bundle_id,
      bundleVersion: event.bundle_version,
      configSnapshotId: event.config_snapshot_id,
      tenantId: event.tenant_id,
      detail: event.detail,
    },
  }, options);
}

function profileContent(profile: GovernanceProfile): GovernanceProfile {
  return sanitize(profile) as GovernanceProfile;
}

function bundleContent(profile: GovernanceProfile, profileId: string): unknown {
  return {
    schema_version: 1,
    profile_id: profileId,
    profile: profileContent(profile),
  };
}

export function createPolicyBundle(input: {
  profile: GovernanceProfile;
  profile_id?: string;
  version: string;
  created_by: string;
  metadata?: Record<string, unknown>;
  tenant_id?: string;
}, options: SafeloopStorageOptions = {}): PolicyBundle {
  const store = readStore(options);
  const profileId = input.profile_id ?? input.profile.id;
  const safeProfile = profileContent(input.profile);
  const contentHash = stableHash(bundleContent(safeProfile, profileId));
  const bundle: PolicyBundle = {
    schema_version: 1,
    bundle_id: `policy-${profileId}-${contentHash.slice(7, 19)}`,
    version: input.version,
    profile_id: profileId,
    created_at: now(),
    created_by: input.created_by,
    content_hash: contentHash,
    status: 'DRAFT',
    profile: safeProfile,
    metadata: sanitize(input.metadata ?? {}) as Record<string, unknown>,
    tenant_id: input.tenant_id,
  };
  if (!store.bundles.some((entry) => entry.bundle_id === bundle.bundle_id && entry.version === bundle.version)) {
    store.bundles.push(bundle);
    recordLifecycleEvent(store, {
      type: 'policy.bundle.created',
      actor: input.created_by,
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: `Policy bundle created: ${bundle.profile_id}@${bundle.version}`,
    }, options);
    writeStoreAtomic(store, options);
  }
  return bundle;
}

function buildConfigSnapshot(bundle: PolicyBundle, actor: string): GovernanceConfigSnapshot {
  const content = {
    profile_id: bundle.profile_id,
    policy_bundle_id: bundle.bundle_id,
    policy_bundle_version: bundle.version,
    policy_hash: bundle.content_hash,
    budgets: bundle.profile.budgets,
    managed_paths: bundle.profile.managed_paths,
    memory_write_policy: bundle.profile.memory_write_policy,
    minimum_memory_confidence: bundle.profile.minimum_memory_confidence,
    runtime_controls: bundle.profile.runtime_controls,
    launch_environment_policy: {
      set_names: Object.keys(bundle.profile.launch_environment?.set ?? {}).sort(),
      unset_names: [...(bundle.profile.launch_environment?.unset ?? [])].sort(),
      rationale: bundle.profile.launch_environment?.rationale,
    },
    adapter_versions: { shell: 'builtin', filesystem: 'builtin', git: 'builtin', http: 'builtin', mcp: 'builtin' },
    feature_flags: {},
    model_provider: {},
    schema_versions: { protocol: PROTOCOL_VERSION, event_model: 1 as const, policy_bundle: 1 as const, config_snapshot: 1 as const },
  };
  const hash = stableHash(content);
  return {
    schema_version: 1,
    snapshot_id: `config-${hash.slice(7, 19)}`,
    version: `${bundle.version}+${hash.slice(7, 15)}`,
    policy_bundle_id: bundle.bundle_id,
    policy_bundle_version: bundle.version,
    policy_hash: bundle.content_hash,
    profile_id: bundle.profile_id,
    runtime_version: POLICY_RUNTIME_VERSION,
    protocol_version: PROTOCOL_VERSION,
    event_schema_version: 1,
    content_hash: hash,
    status: 'VALIDATED',
    created_at: now(),
    created_by: actor,
    content,
    tenant_id: bundle.tenant_id,
  };
}

function goldenControls(profile: GovernanceProfile): GoldenPolicyControlsResult {
  const safe = canonicalizeAction({
    action_kind: 'filesystem',
    operation: 'read',
    target: 'safe.txt',
    arguments: {},
    agent_id: 'golden-agent',
  });
  const dangerous = canonicalizeAction({
    action_kind: 'filesystem',
    operation: 'delete',
    target: '/etc/passwd',
    arguments: {},
    agent_id: 'golden-agent',
  });
  const safeDisposition = evaluateProfile(profile, safe, '/tmp/safeloop-phase6-workspace').disposition;
  const dangerousDisposition = evaluateProfile(profile, dangerous, '/tmp/safeloop-phase6-workspace').disposition;
  const controls: GoldenPolicyControlResult[] = [
    {
      id: 'safe-read',
      polarity: 'positive',
      expected: ['ALLOW', 'ALLOW_WITH_WARNING', 'REQUIRE_APPROVAL'],
      observed: safeDisposition,
      status: ['ALLOW', 'ALLOW_WITH_WARNING', 'REQUIRE_APPROVAL'].includes(safeDisposition) ? 'pass' : 'fail',
    },
    {
      id: 'dangerous-outside-delete',
      polarity: 'negative',
      expected: ['DENY', 'STOP_AGENT', 'REQUIRE_APPROVAL', 'PAUSE'],
      observed: dangerousDisposition,
      status: ['DENY', 'STOP_AGENT', 'REQUIRE_APPROVAL', 'PAUSE'].includes(dangerousDisposition) ? 'pass' : 'fail',
    },
  ];
  return {
    positive_pass: controls.filter((entry) => entry.polarity === 'positive').every((entry) => entry.status === 'pass'),
    negative_pass: controls.filter((entry) => entry.polarity === 'negative').every((entry) => entry.status === 'pass'),
    controls,
  };
}

export function validatePolicyBundle(bundleId: string, actor: string, options: SafeloopStorageOptions = {}): PolicyValidationResult {
  const store = readStore(options);
  const bundle = store.bundles.find((entry) => entry.bundle_id === bundleId);
  if (!bundle) throw new Error('policy_bundle_not_found');
  const errors: string[] = [];
  const warnings: string[] = [];
  if (bundle.schema_version !== SUPPORTED_SCHEMA_VERSION) errors.push('unsupported_policy_bundle_schema_version');
  if (stableHash(bundleContent(bundle.profile, bundle.profile_id)) !== bundle.content_hash) errors.push('policy_bundle_hash_mismatch');
  try {
    validateProfile(bundle.profile);
  } catch (error) {
    errors.push(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
  if (!bundle.profile.rules?.length) errors.push('profile_has_no_rules');
  const golden = goldenControls(bundle.profile);
  if (!golden.positive_pass) errors.push('positive_golden_control_failed');
  if (!golden.negative_pass) errors.push('negative_golden_control_failed');
  const result: PolicyValidationResult = {
    validation_id: `validation-${Date.now()}-${bundle.content_hash.slice(7, 15)}`,
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    validated_at: now(),
    valid: errors.length === 0,
    errors,
    warnings,
    golden_controls: golden,
  };
  store.validations.push(result);
  bundle.status = result.valid ? (['APPROVED', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'].includes(bundle.status) ? bundle.status : 'VALIDATED') : 'INVALID';
  recordLifecycleEvent(store, {
    type: result.valid ? 'policy.bundle.validated' : 'policy.bundle.validation_failed',
    actor,
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    tenant_id: bundle.tenant_id,
    summary: result.valid ? `Policy bundle validated: ${bundle.profile_id}@${bundle.version}` : `Policy bundle validation failed: ${bundle.profile_id}@${bundle.version}`,
    detail: { validation: result },
  }, options);
  writeStoreAtomic(store, options);
  return result;
}

export function approvePolicyBundle(bundleId: string, actor: string, options: SafeloopStorageOptions = {}): PolicyBundle {
  const store = readStore(options);
  const bundle = store.bundles.find((entry) => entry.bundle_id === bundleId);
  if (!bundle) throw new Error('policy_bundle_not_found');
  if (bundle.status !== 'VALIDATED' && bundle.status !== 'APPROVED') throw new Error(`invalid_policy_lifecycle_transition:${bundle.status}->APPROVED`);
  bundle.status = 'APPROVED';
  recordLifecycleEvent(store, {
    type: 'policy.bundle.approved',
    actor,
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    tenant_id: bundle.tenant_id,
    summary: `Policy bundle approved: ${bundle.profile_id}@${bundle.version}`,
  }, options);
  writeStoreAtomic(store, options);
  return bundle;
}

export function activatePolicyBundle(input: {
  bundle_id: string;
  actor: string;
  approved_by: string;
  request_id?: string;
  reason?: string;
  fail_after_validation?: boolean;
  tenant_id?: string;
}, options: SafeloopStorageOptions = {}): PolicyActivationRecord {
  const store = readStore(options);
  const requestId = input.request_id ?? `activation:${input.bundle_id}`;
  const existingId = store.idempotency[requestId];
  if (existingId) {
    const existing = store.activations.find((entry) => entry.activation_id === existingId);
    if (existing) return existing;
  }
  const bundle = store.bundles.find((entry) => entry.bundle_id === input.bundle_id && (!input.tenant_id || entry.tenant_id === input.tenant_id));
  if (!bundle) throw new Error('policy_bundle_not_found');
  if (bundle.tenant_id && input.tenant_id && bundle.tenant_id !== input.tenant_id) throw new Error('cross_tenant_policy_activation_denied');
  const validation = validatePolicyBundle(bundle.bundle_id, input.actor, options);
  const fresh = readStore(options);
  const freshBundle = fresh.bundles.find((entry) => entry.bundle_id === bundle.bundle_id);
  if (!freshBundle) throw new Error('policy_bundle_not_found');
  if (!validation.valid) {
    recordLifecycleEvent(fresh, {
      type: 'policy.bundle.activation_failed',
      actor: input.actor,
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: `Policy activation failed validation: ${bundle.profile_id}@${bundle.version}`,
      detail: { validation },
    }, options);
    writeStoreAtomic(fresh, options);
    throw new Error('policy_validation_failed');
  }
  if (freshBundle.status !== 'APPROVED' && freshBundle.status !== 'ACTIVE' && freshBundle.status !== 'SUPERSEDED' && freshBundle.status !== 'ROLLED_BACK') {
    recordLifecycleEvent(fresh, {
      type: 'policy.bundle.activation_failed',
      actor: input.actor,
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: `Policy activation rejected: bundle is ${freshBundle.status}`,
    }, options);
    writeStoreAtomic(fresh, options);
    throw new Error(`policy_bundle_not_approved:${freshBundle.status}`);
  }
  if (input.fail_after_validation) {
    recordLifecycleEvent(fresh, {
      type: 'policy.bundle.activation_failed',
      actor: input.actor,
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: 'Policy activation failed before atomic state update',
    }, options);
    writeStoreAtomic(fresh, options);
    throw new Error('activation_persistence_failed');
  }
  const previous = fresh.active;
  const previousBundle = previous ? fresh.bundles.find((entry) => entry.bundle_id === previous.bundle_id) : undefined;
  const snapshot = buildConfigSnapshot(freshBundle, input.actor);
  const existingSnapshot = fresh.config_snapshots.find((entry) => entry.snapshot_id === snapshot.snapshot_id);
  if (!existingSnapshot) fresh.config_snapshots.push(snapshot);
  for (const entry of fresh.bundles) {
    if (entry.bundle_id === freshBundle.bundle_id) entry.status = 'ACTIVE';
    else if (entry.status === 'ACTIVE') entry.status = 'SUPERSEDED';
  }
  const activation: PolicyActivationRecord = {
    activation_id: `activation-${Date.now()}-${freshBundle.content_hash.slice(7, 15)}`,
    request_id: requestId,
    bundle_id: freshBundle.bundle_id,
    bundle_version: freshBundle.version,
    config_snapshot_id: snapshot.snapshot_id,
    previous_bundle_id: previous?.bundle_id,
    previous_config_snapshot_id: previous?.config_snapshot_id,
    actor: input.actor,
    approved_by: input.approved_by,
    approved_at: now(),
    activated_at: now(),
    validation_id: validation.validation_id,
    golden_controls_passed: validation.golden_controls.positive_pass && validation.golden_controls.negative_pass,
    reason: redactSecrets(input.reason ?? ''),
  };
  fresh.active = {
    bundle_id: freshBundle.bundle_id,
    config_snapshot_id: snapshot.snapshot_id,
    activated_at: activation.activated_at,
    activation_id: activation.activation_id,
  };
  fresh.activations.push(activation);
  fresh.idempotency[requestId] = activation.activation_id;
  if (previousBundle && previousBundle.bundle_id !== freshBundle.bundle_id) {
    recordLifecycleEvent(fresh, {
      type: 'policy.bundle.superseded',
      actor: input.actor,
      bundle_id: previousBundle.bundle_id,
      bundle_version: previousBundle.version,
      config_snapshot_id: previous?.config_snapshot_id,
      tenant_id: previousBundle.tenant_id,
      summary: `Policy bundle superseded: ${previousBundle.profile_id}@${previousBundle.version}`,
    }, options);
  }
  recordLifecycleEvent(fresh, {
    type: 'policy.bundle.activated',
    actor: input.actor,
    bundle_id: freshBundle.bundle_id,
    bundle_version: freshBundle.version,
    config_snapshot_id: snapshot.snapshot_id,
    previous_bundle_id: previous?.bundle_id,
    previous_config_snapshot_id: previous?.config_snapshot_id,
    tenant_id: freshBundle.tenant_id,
    summary: `Policy bundle activated: ${freshBundle.profile_id}@${freshBundle.version}`,
    detail: { validation_id: validation.validation_id, golden_controls_passed: activation.golden_controls_passed, reason: activation.reason },
  }, options);
  writeStoreAtomic(fresh, options);
  return activation;
}

export function rollbackPolicy(input: {
  target_bundle_id: string;
  actor: string;
  approved_by: string;
  reason: string;
  request_id?: string;
  tenant_id?: string;
}, options: SafeloopStorageOptions = {}): PolicyActivationRecord {
  const store = readStore(options);
  const active = store.active;
  recordLifecycleEvent(store, {
    type: 'policy.rollback.initiated',
    actor: input.actor,
    bundle_id: input.target_bundle_id,
    previous_bundle_id: active?.bundle_id,
    previous_config_snapshot_id: active?.config_snapshot_id,
    tenant_id: input.tenant_id,
    summary: `Policy rollback initiated to ${input.target_bundle_id}`,
    detail: { reason: input.reason },
  }, options);
  writeStoreAtomic(store, options);
  const activation = activatePolicyBundle({
    bundle_id: input.target_bundle_id,
    actor: input.actor,
    approved_by: input.approved_by,
    request_id: input.request_id ?? `rollback:${active?.bundle_id ?? 'none'}:${input.target_bundle_id}`,
    reason: input.reason,
    tenant_id: input.tenant_id,
  }, options);
  const after = readStore(options);
  const bundle = after.bundles.find((entry) => entry.bundle_id === activation.bundle_id);
  if (bundle) bundle.status = 'ACTIVE';
  const activeBefore = active ? after.bundles.find((entry) => entry.bundle_id === active.bundle_id) : undefined;
  if (activeBefore && activeBefore.bundle_id !== activation.bundle_id) activeBefore.status = 'ROLLED_BACK';
  const activationRecord = after.activations.find((entry) => entry.activation_id === activation.activation_id);
  if (activationRecord) activationRecord.rollback_from_bundle_id = active?.bundle_id;
  recordLifecycleEvent(after, {
    type: 'policy.rollback.completed',
    actor: input.actor,
    bundle_id: activation.bundle_id,
    bundle_version: activation.bundle_version,
    config_snapshot_id: activation.config_snapshot_id,
    previous_bundle_id: active?.bundle_id,
    previous_config_snapshot_id: active?.config_snapshot_id,
    tenant_id: input.tenant_id,
    summary: `Policy rollback completed to ${activation.bundle_version}`,
    detail: { reason: input.reason },
  }, options);
  writeStoreAtomic(after, options);
  return activationRecord ?? activation;
}

export function ensureBaselinePolicyLifecycle(profileId: string, actor = 'safeloop-runtime', options: SafeloopStorageOptions = {}): PolicyLifecycleStatus {
  const store = readStore(options);
  const activeBundle = store.active ? store.bundles.find((entry) => entry.bundle_id === store.active?.bundle_id) : undefined;
  if (activeBundle && activeBundle.profile_id === profileId) return policyLifecycleStatus(options);
  if (activeBundle && activeBundle.profile_id !== profileId) throw new Error('active_policy_profile_mismatch');
  const profile = loadProfile(profileId);
  const bundle = createPolicyBundle({ profile, profile_id: profileId, version: `baseline-${profileId}`, created_by: actor, metadata: { imported_from: 'profiles directory' } }, options);
  validatePolicyBundle(bundle.bundle_id, actor, options);
  approvePolicyBundle(bundle.bundle_id, actor, options);
  activatePolicyBundle({ bundle_id: bundle.bundle_id, actor, approved_by: actor, request_id: `baseline:${profileId}`, reason: 'import existing effective profile as immutable baseline' }, options);
  return policyLifecycleStatus(options);
}

export function activePolicyProvenance(profileId: string, options: SafeloopStorageOptions = {}): PolicyDecisionProvenance {
  const status = ensureBaselinePolicyLifecycle(profileId, 'safeloop-runtime', options);
  if (!status.active_bundle || !status.active_config) throw new Error('active_policy_missing');
  return {
    policy_bundle_id: status.active_bundle.bundle_id,
    policy_bundle_version: status.active_bundle.version,
    policy_hash: status.active_bundle.content_hash,
    config_snapshot_id: status.active_config.snapshot_id,
    config_hash: status.active_config.content_hash,
    runtime_version: POLICY_RUNTIME_VERSION,
    protocol_version: PROTOCOL_VERSION,
    event_schema_version: 1,
    profile: status.active_bundle.profile_id,
  };
}

export function resolveHistoricalPolicyContext(provenance: PolicyDecisionProvenance, options: SafeloopStorageOptions = {}): { bundle: PolicyBundle; config: GovernanceConfigSnapshot } {
  const store = readStore(options);
  const bundle = store.bundles.find((entry) => entry.bundle_id === provenance.policy_bundle_id && entry.content_hash === provenance.policy_hash);
  const config = store.config_snapshots.find((entry) => entry.snapshot_id === provenance.config_snapshot_id && entry.content_hash === provenance.config_hash);
  if (!bundle || !config) throw new Error('historical_policy_context_not_resolvable');
  return { bundle, config };
}

export function detectPolicyDrift(options: SafeloopStorageOptions = {}): { state: PolicyDriftState; reasons: string[] } {
  try {
    const store = readStore(options);
    if (!store.active) return { state: 'DRIFT', reasons: ['active_policy_missing'] };
    const bundle = store.bundles.find((entry) => entry.bundle_id === store.active?.bundle_id);
    const config = store.config_snapshots.find((entry) => entry.snapshot_id === store.active?.config_snapshot_id);
    const reasons: string[] = [];
    if (!bundle) reasons.push('active_bundle_missing');
    if (!config) reasons.push('active_config_snapshot_missing');
    if (bundle && stableHash(bundleContent(bundle.profile, bundle.profile_id)) !== bundle.content_hash) reasons.push('policy_hash_mismatch');
    if (bundle && config && buildConfigSnapshot(bundle, config.created_by).content_hash !== config.content_hash) reasons.push('config_hash_mismatch');
    return { state: reasons.length ? 'DRIFT' : 'NO_DRIFT', reasons };
  } catch (error) {
    return { state: 'UNKNOWN', reasons: [redactSecrets(error instanceof Error ? error.message : String(error))] };
  }
}

export function policyLifecycleStatus(options: SafeloopStorageOptions = {}): PolicyLifecycleStatus {
  const store = readStore(options);
  const activeBundle = store.active ? store.bundles.find((entry) => entry.bundle_id === store.active?.bundle_id) : undefined;
  const activeConfig = store.active ? store.config_snapshots.find((entry) => entry.snapshot_id === store.active?.config_snapshot_id) : undefined;
  const drift = detectPolicyDrift(options);
  return {
    active_bundle: activeBundle ? sanitize(activeBundle) as PolicyBundle : undefined,
    active_config: activeConfig ? sanitize(activeConfig) as GovernanceConfigSnapshot : undefined,
    drift_state: drift.state,
    drift_reasons: drift.reasons,
    latest_validation: store.validations[store.validations.length - 1] ? sanitize(store.validations[store.validations.length - 1]) as PolicyValidationResult : undefined,
    latest_activation: store.activations[store.activations.length - 1] ? sanitize(store.activations[store.activations.length - 1]) as PolicyActivationRecord : undefined,
    bundle_count: store.bundles.length,
    config_snapshot_count: store.config_snapshots.length,
  };
}

export function readPolicyLifecycleStore(options: SafeloopStorageOptions = {}): PolicyLifecycleStore {
  return readStore(options);
}

export function safePolicyDiff(leftBundleId: string, rightBundleId: string, options: SafeloopStorageOptions = {}): Array<{ path: string; before: unknown; after: unknown; change: 'added' | 'removed' | 'changed' }> {
  const store = readStore(options);
  const left = store.bundles.find((entry) => entry.bundle_id === leftBundleId);
  const right = store.bundles.find((entry) => entry.bundle_id === rightBundleId);
  if (!left || !right) throw new Error('policy_bundle_not_found');
  const diffs: Array<{ path: string; before: unknown; after: unknown; change: 'added' | 'removed' | 'changed' }> = [];
  const walk = (path: string, a: unknown, b: unknown): void => {
    if (canonicalJson(a) === canonicalJson(b)) return;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) {
      diffs.push({ path, before: sanitize(a), after: sanitize(b), change: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed' });
      return;
    }
    const keys = new Set([...Object.keys(a as Record<string, unknown>), ...Object.keys(b as Record<string, unknown>)]);
    for (const key of Array.from(keys).sort()) walk(`${path}.${key}`, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
  };
  walk('profile', left.profile, right.profile);
  return diffs.slice(0, 200);
}

export function corruptPolicyLifecycleForTest(mutator: (store: PolicyLifecycleStore) => void, options: SafeloopStorageOptions = {}): void {
  const store = readStore(options);
  mutator(store);
  writeStoreAtomic(store, options);
}

export function writeMalformedPolicyLifecycleForTest(raw: string, options: SafeloopStorageOptions = {}): void {
  const path = lifecyclePath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, raw, 'utf8');
}

export function policyLifecycleFileExists(options: SafeloopStorageOptions = {}): boolean {
  return existsSync(lifecyclePath(options));
}
