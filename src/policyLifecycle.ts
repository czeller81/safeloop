import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendEvent } from './eventStream';
import { ensureParentDir, resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';
import { redactSecrets } from './runtime/redaction';
import { canonicalizeAction } from './runtime/canonicalAction';
import { evaluateProfile, loadProfile, moreSevere, validateProfile, type GovernanceProfile } from './runtime/profiles';
import { PROTOCOL_VERSION, type RuntimeDispositionCode } from './runtime/protocol';
import { createBudgetTracker } from './runtime/budgets';
import { verifyCandidateMemory } from './runtimeGovernance';

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
export type PolicyStoreReadState = 'STORE_NOT_INITIALIZED' | 'STORE_VALID' | 'STORE_CORRUPT' | 'UNSUPPORTED_SCHEMA';

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
  /** True only when every REQUIRED control ran and passed with complete coverage. */
  golden_controls_passed: boolean;
  control_set_version: string;
  /** Full required-control manifest, so an auditor never has to trust the boolean. */
  control_manifest: GoldenPolicyControlsResult;
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
  control_set_version: string;
  golden_controls: GoldenPolicyControlsResult;
}

export interface GoldenPolicyControlResult {
  id: string;
  family: string;
  polarity: 'positive' | 'negative';
  applicability: GoldenControlApplicability;
  expected: string[];
  observed: string;
  status: GoldenControlStatus;
  detail?: string;
}

export interface GoldenPolicyControlsResult {
  control_set_version: string;
  /** Every governance family, each explicitly REQUIRED or NOT_APPLICABLE. */
  families: GovernanceFamilyDeclaration[];
  required_control_ids: string[];
  executed_control_ids: string[];
  coverage_errors: string[];
  coverage_complete: boolean;
  positive_pass: boolean;
  negative_pass: boolean;
  /** True only when every required control actually ran and passed. */
  all_required_passed: boolean;
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
    profile_id?: string;
  };
  active_by_profile?: Record<string, { bundle_id: string; config_snapshot_id: string; activated_at: string; activation_id: string; profile_id?: string }>;
  revision?: number;
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
  lifecycle_revision?: number;
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
  store_state?: PolicyStoreReadState;
  revision?: number;
  active_by_profile?: Record<string, { bundle_id: string; config_snapshot_id: string; activated_at: string; activation_id: string; profile_id?: string }>;
}

const STORE_FILE = 'policy-lifecycle.json';
const LOCK_DIR = 'policy-lifecycle.lock';
let lifecycleLockDepth = 0;
const provenanceCache = new Map<string, { mtimeMs: number; provenance: PolicyDecisionProvenance }>();
const SUPPORTED_SCHEMA_VERSION = 1;
const POLICY_RUNTIME_VERSION = '0.2.0';
const SECRET_KEYS = /(?:password|secret|credential|api[_-]?key|authorization|private[_-]?key|client_secret|operator|bearer|access[_-]?key|auth[_-]?token|session[_-]?token|token[_-]?value)/i;
const GOLDEN_CONTROL_SET_VERSION = 'phase6-v3';

/**
 * Every action kind the rule engine can dispatch on. Kept beside the family
 * table so a new enforcement surface cannot be added without either a control
 * or an explicit NOT_APPLICABLE justification.
 */
const GOVERNANCE_ACTION_KINDS = ['shell', 'filesystem', 'git', 'http', 'memory', 'mcp', 'delegation', 'custom'] as const;
export const POLICY_LIFECYCLE_LIMITS = {
  MAX_POLICY_PAYLOAD_BYTES: 512 * 1024,
  MAX_NESTING_DEPTH: 48,
  MAX_RULE_COUNT: 500,
  MAX_ARRAY_LENGTH: 1000,
  MAX_STRING_LENGTH: 16 * 1024,
  MAX_METADATA_BYTES: 64 * 1024,
} as const;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, 0));
}

export function stableHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalValue(value: unknown, depth: number): unknown {
  if (depth > POLICY_LIFECYCLE_LIMITS.MAX_NESTING_DEPTH) throw new Error('lifecycle_input_limit_exceeded:max_nesting_depth');
  if (typeof value === 'string' && value.length > POLICY_LIFECYCLE_LIMITS.MAX_STRING_LENGTH) throw new Error('lifecycle_input_limit_exceeded:max_string_length');
  if (Array.isArray(value)) {
    if (value.length > POLICY_LIFECYCLE_LIMITS.MAX_ARRAY_LENGTH) throw new Error('lifecycle_input_limit_exceeded:max_array_length');
    return value.map((entry) => canonicalValue(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key], depth + 1)]));
}

function now(): string {
  return new Date().toISOString();
}

function lockPath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath(LOCK_DIR, options);
}

function sleepMs(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {}
}

function withLifecycleLock<T>(options: SafeloopStorageOptions, fn: () => T): T {
  if (lifecycleLockDepth > 0) return fn();
  const path = lockPath(options);
  ensureParentDir(path);
  const deadline = Date.now() + 5000;
  lifecycleLockDepth += 1;
  let acquired = false;
  try {
    while (!acquired) {
      try {
        mkdirSync(path);
        writeFileSync(join(path, 'owner'), `${process.pid}:${Date.now()}`, 'utf8');
        acquired = true;
      } catch {
        if (existsSync(path)) {
          try {
            if (Date.now() - statSync(path).mtimeMs > 30000) rmSync(path, { recursive: true, force: true });
          } catch {}
        }
        if (Date.now() > deadline) throw new Error('policy_lifecycle_lock_timeout');
        sleepMs(10);
      }
    }
    return fn();
  } finally {
    lifecycleLockDepth -= 1;
    if (acquired) {
      try { rmdirSync(path); } catch { rmSync(path, { recursive: true, force: true }); }
    }
  }
}
function lifecyclePath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath(STORE_FILE, options);
}

function emptyStore(): PolicyLifecycleStore {
  return { schema_version: 1, revision: 0, bundles: [], config_snapshots: [], active_by_profile: {}, activations: [], validations: [], events: [], idempotency: {} };
}

function sanitizeIdentity(value: string): string {
  return redactSecrets(value || 'unknown').slice(0, 256);
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

function readStoreState(options: SafeloopStorageOptions = {}): { state: PolicyStoreReadState; store?: PolicyLifecycleStore; error?: string } {
  const path = lifecyclePath(options);
  if (!existsSync(path)) return { state: 'STORE_NOT_INITIALIZED' };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return { state: 'STORE_CORRUPT', error: redactSecrets(error instanceof Error ? error.message : String(error)) };
  }
  if (!raw.trim()) return { state: 'STORE_CORRUPT', error: 'empty policy lifecycle store' };
  let parsed: PolicyLifecycleStore;
  try {
    parsed = JSON.parse(raw) as PolicyLifecycleStore;
  } catch (error) {
    return { state: 'STORE_CORRUPT', error: redactSecrets(error instanceof Error ? error.message : String(error)) };
  }
  if (parsed.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return { state: 'UNSUPPORTED_SCHEMA', error: `unsupported policy lifecycle schema version: ${String((parsed as { schema_version?: unknown }).schema_version)}` };
  }
  const activeByProfile = parsed.active_by_profile && typeof parsed.active_by_profile === 'object'
    ? parsed.active_by_profile
    : parsed.active?.profile_id
      ? { [parsed.active.profile_id]: parsed.active }
      : {};
  return { state: 'STORE_VALID', store: {
    ...emptyStore(),
    ...parsed,
    revision: Number.isSafeInteger(parsed.revision) && (parsed.revision ?? 0) >= 0 ? parsed.revision : 0,
    active_by_profile: activeByProfile,
    bundles: Array.isArray(parsed.bundles) ? parsed.bundles : [],
    config_snapshots: Array.isArray(parsed.config_snapshots) ? parsed.config_snapshots : [],
    activations: Array.isArray(parsed.activations) ? parsed.activations : [],
    validations: Array.isArray(parsed.validations) ? parsed.validations : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    idempotency: parsed.idempotency && typeof parsed.idempotency === 'object' ? parsed.idempotency : {},
  } };
}

function readStore(options: SafeloopStorageOptions = {}): PolicyLifecycleStore {
  const result = readStoreState(options);
  if (result.state === 'STORE_VALID' && result.store) return result.store;
  if (result.state === 'STORE_NOT_INITIALIZED') return emptyStore();
  throw new Error(result.state === 'UNSUPPORTED_SCHEMA' ? 'policy_lifecycle_unsupported_schema' : 'policy_lifecycle_store_corrupt');
}

function readExistingStore(options: SafeloopStorageOptions = {}): PolicyLifecycleStore {
  const result = readStoreState(options);
  if (result.state === 'STORE_VALID' && result.store) return result.store;
  throw new Error(result.state === 'STORE_NOT_INITIALIZED' ? 'policy_lifecycle_store_not_initialized' : result.state === 'UNSUPPORTED_SCHEMA' ? 'policy_lifecycle_unsupported_schema' : 'policy_lifecycle_store_corrupt');
}

function writeStoreAtomic(store: PolicyLifecycleStore, options: SafeloopStorageOptions = {}): void {
  const path = lifecyclePath(options);
  ensureParentDir(path);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
  provenanceCache.clear();
}


interface LifecycleMutationResult<T> {
  result: T;
  changed: boolean;
}

function mutationResult<T>(result: T, changed = true): LifecycleMutationResult<T> {
  return { result, changed };
}

function withLifecycleMutation<T>(options: SafeloopStorageOptions, fn: (store: PolicyLifecycleStore, baseRevision: number) => LifecycleMutationResult<T>): T {
  return withLifecycleLock(options, () => {
    // compute/validate -> construct next state -> commit -> emit committed event.
    const outerStage = stagedLifecycleExports;
    const staged: Array<() => void> = [];
    stagedLifecycleExports = staged;
    let committed = false;
    try {
      const store = readStore(options);
      const baseRevision = store.revision ?? 0;
      const outcome = fn(store, baseRevision);
      if (!outcome.changed) return outcome.result;
      const current = readStoreState(options);
      if (current.state === 'STORE_VALID' && current.store && (current.store.revision ?? 0) !== baseRevision) {
        throw new Error('stale_lifecycle_write');
      }
      if (current.state !== 'STORE_VALID' && current.state !== 'STORE_NOT_INITIALIZED') {
        throw new Error(current.state === 'UNSUPPORTED_SCHEMA' ? 'policy_lifecycle_unsupported_schema' : 'policy_lifecycle_store_corrupt');
      }
      store.revision = baseRevision + 1;
      writeStoreAtomic(store, options);
      committed = true;
      return outcome.result;
    } finally {
      stagedLifecycleExports = outerStage;
      // Only a committed transaction may announce itself. An export failure
      // after this point never rolls back the authoritative state.
      if (committed) for (const emit of staged) emit();
    }
  });
}

function assertPolicyInputWithinLimits(profile: GovernanceProfile, metadata: Record<string, unknown> = {}): void {
  const payloadBytes = Buffer.byteLength(canonicalJson(profile), 'utf8');
  if (payloadBytes > POLICY_LIFECYCLE_LIMITS.MAX_POLICY_PAYLOAD_BYTES) throw new Error('lifecycle_input_limit_exceeded:max_policy_payload_bytes');
  if ((profile.rules ?? []).length > POLICY_LIFECYCLE_LIMITS.MAX_RULE_COUNT) throw new Error('lifecycle_input_limit_exceeded:max_rule_count');
  const metadataBytes = Buffer.byteLength(canonicalJson(metadata), 'utf8');
  if (metadataBytes > POLICY_LIFECYCLE_LIMITS.MAX_METADATA_BYTES) throw new Error('lifecycle_input_limit_exceeded:max_metadata_bytes');
}


function activeFor(store: PolicyLifecycleStore, profileId: string): PolicyLifecycleStore['active'] | undefined {
  return store.active_by_profile?.[profileId] ?? (store.active?.profile_id === profileId ? store.active : undefined);
}

function setActiveFor(store: PolicyLifecycleStore, profileId: string, active: NonNullable<PolicyLifecycleStore['active']>): void {
  active.profile_id = profileId;
  store.active_by_profile = store.active_by_profile ?? {};
  store.active_by_profile[profileId] = active;
  store.active = active;
}

function verifyBundleIntegrity(bundle: PolicyBundle): void {
  if (stableHash(bundleContent(bundle.profile, bundle.profile_id)) !== bundle.content_hash) throw new Error('policy_hash_mismatch');
}

function verifyConfigIntegrity(config: GovernanceConfigSnapshot, bundle: PolicyBundle): void {
  if (stableHash(config.content) !== config.content_hash) throw new Error('config_content_hash_mismatch');
  if (config.policy_bundle_id !== bundle.bundle_id || config.policy_hash !== bundle.content_hash) throw new Error('config_policy_reference_mismatch');
  if (config.content.policy_bundle_id !== bundle.bundle_id || config.content.policy_hash !== bundle.content_hash) throw new Error('config_content_policy_reference_mismatch');
  if (buildConfigSnapshot(bundle, config.created_by).content_hash !== config.content_hash) throw new Error('config_hash_mismatch');
}
/**
 * Event-stream exports staged by the in-flight lifecycle mutation.
 *
 * Phase 6.2 review found a failed activation could leave a
 * `policy.bundle.validated` line in `.safeloop/events.jsonl` even though the
 * lifecycle transaction never committed, so the operational stream claimed
 * authoritative validation that no authoritative state supported. Exports are
 * therefore staged here and flushed only after the store is durably written.
 * If the mutation throws, the staged exports are discarded with the uncommitted
 * store, and nothing ever claims a success that did not happen.
 */
let stagedLifecycleExports: Array<() => void> | null = null;

function recordLifecycleEvent(store: PolicyLifecycleStore, input: Omit<PolicyLifecycleEvent, 'id' | 'timestamp'>, options: SafeloopStorageOptions): void {
  const event: PolicyLifecycleEvent = {
    id: `policy-event-${Date.now()}-${createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 10)}`,
    timestamp: now(),
    ...input,
    detail: input.detail ? sanitize(input.detail) as Record<string, unknown> : undefined,
  };
  store.events.push(event);
  const exportEvent = (): void => {
    try {
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
    } catch {
      // Post-commit export is best effort. The lifecycle store is authoritative
      // and stays committed; only telemetry/export health degrades.
    }
  };
  if (stagedLifecycleExports) stagedLifecycleExports.push(exportEvent);
  else exportEvent();
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
  return withLifecycleMutation(options, (store) => {
    const profileId = input.profile_id ?? input.profile.id;
    assertPolicyInputWithinLimits(input.profile, input.metadata ?? {});
    const safeProfile = profileContent(input.profile);
    const contentHash = stableHash(bundleContent(safeProfile, profileId));
    const existing = store.bundles.find((entry) => entry.bundle_id === `policy-${profileId}-${contentHash.slice(7, 19)}` && entry.version === input.version);
    if (existing) return mutationResult(existing, false);
    const bundle: PolicyBundle = {
      schema_version: 1,
      bundle_id: `policy-${profileId}-${contentHash.slice(7, 19)}`,
      version: input.version,
      profile_id: profileId,
      created_at: now(),
      created_by: sanitizeIdentity(input.created_by),
      content_hash: contentHash,
      status: 'DRAFT',
      profile: safeProfile,
      metadata: sanitize(input.metadata ?? {}) as Record<string, unknown>,
      tenant_id: input.tenant_id,
    };
    store.bundles.push(bundle);
    recordLifecycleEvent(store, {
      type: 'policy.bundle.created',
      actor: sanitizeIdentity(input.created_by),
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: `Policy bundle created: ${bundle.profile_id}@${bundle.version}`,
      detail: { prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
    }, options);
    return mutationResult(bundle);
  });
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
    created_by: sanitizeIdentity(actor),
    content,
    tenant_id: bundle.tenant_id,
  };
}


/**
 * Budget structure required by current SafeLoop semantics.
 *
 * createBudgetTracker treats an absent limit as unlimited (`exceeded()` only
 * fires when the limit is a number), so `budgets: {}` silently removes the
 * pre-execution admission check entirely. maximum_actions is the category
 * checked before every managed execution, so a bundle must declare it. The
 * remaining categories stay optional, matching the tracker's own semantics.
 */
const REQUIRED_BUDGET_CATEGORIES = ['maximum_actions'] as const;
const INTEGER_BUDGET_CATEGORIES = new Set(['maximum_actions', 'maximum_runtime_ms', 'maximum_tokens', 'maximum_retries']);

function validateLifecycleProfile(profile: GovernanceProfile): string[] {
  const errors: string[] = [];
  if (profile.budgets !== undefined && (typeof profile.budgets !== 'object' || profile.budgets === null || Array.isArray(profile.budgets))) {
    errors.push('budgets_must_be_object');
  }
  const budget = (typeof profile.budgets === 'object' && profile.budgets !== null && !Array.isArray(profile.budgets) ? profile.budgets : {}) as Record<string, unknown>;
  for (const key of REQUIRED_BUDGET_CATEGORIES) {
    if (budget[key] === undefined) errors.push(`budgets.${key}_is_required`);
  }
  for (const key of ['maximum_actions', 'maximum_runtime_ms', 'maximum_tokens', 'maximum_cost_usd', 'maximum_retries'] as const) {
    const value = budget[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) { errors.push(`budgets.${key}_must_be_finite_number`); continue; }
    if (value < 0) errors.push(`budgets.${key}_must_be_non_negative`);
    // A zero limit is exhausted before the first action, which is not a budget.
    if ((REQUIRED_BUDGET_CATEGORIES as readonly string[]).includes(key) && value <= 0) errors.push(`budgets.${key}_must_be_positive`);
    if (INTEGER_BUDGET_CATEGORIES.has(key) && !Number.isSafeInteger(value)) errors.push(`budgets.${key}_must_be_safe_integer`);
  }
  if (typeof profile.minimum_memory_confidence !== 'number' || !Number.isFinite(profile.minimum_memory_confidence) || profile.minimum_memory_confidence < 0 || profile.minimum_memory_confidence > 1) errors.push('minimum_memory_confidence_invalid');
  const validManaged = new Set(['MANAGED', 'UNMANAGED', 'DISABLED', 'UNREACHABLE', 'PENDING_VERIFICATION', 'VERIFICATION_FAILED']);
  if (!Array.isArray(profile.managed_paths)) errors.push('managed_paths_must_be_array');
  for (const [index, entry] of (profile.managed_paths ?? []).entries()) {
    if (!validManaged.has(entry.state)) errors.push(`managed_paths.${index}.state_invalid`);
    if (typeof entry.consequential !== 'boolean') errors.push(`managed_paths.${index}.consequential_invalid`);
    if (typeof entry.certification_impact !== 'boolean') errors.push(`managed_paths.${index}.certification_impact_invalid`);
  }
  const validMemory = new Set(['allow', 'allow_with_ttl', 'require_review', 'quarantine', 'reject']);
  if (!validMemory.has(profile.memory_write_policy)) errors.push('memory_write_policy_invalid');
  return errors;
}
/**
 * Golden control completeness model.
 *
 * Phase 6.2 review found that a candidate policy could activate while whole
 * enforcement families were simply absent from the control set, and that a
 * global `golden_controls_passed: true` could be produced by `.every()` over an
 * empty or partial control list. Activation must fail closed not only when a
 * control fails, but when SafeLoop cannot prove that every lifecycle-relevant
 * governance family was actually exercised.
 *
 * `GOVERNANCE_CONTROL_FAMILIES` is therefore the authoritative enumeration of
 * every governance surface the evaluator can dispatch on, plus the cross-cutting
 * mechanisms a candidate bundle can materially alter. Every family carries an
 * explicit applicability. A family is never silently omitted.
 */
export type GoldenControlApplicability = 'REQUIRED' | 'NOT_APPLICABLE';
export type GoldenControlStatus = 'pass' | 'fail' | 'error' | 'unknown';

export interface GovernanceFamilyDeclaration {
  family: string;
  applicability: GoldenControlApplicability;
  /** Why this family is lifecycle-relevant, or the architectural reason it cannot be. */
  reason: string;
}

/**
 * Applicability is decided by one question: can a candidate policy bundle
 * change this mechanism's behavior? Only `GovernanceProfile` fields travel
 * inside a bundle, so a mechanism with no profile input cannot be gated by
 * lifecycle validation and is marked NOT_APPLICABLE with its reason recorded.
 */
export const GOVERNANCE_CONTROL_FAMILIES: readonly GovernanceFamilyDeclaration[] = [
  { family: 'filesystem', applicability: 'REQUIRED', reason: 'Profile rules match action_kind filesystem and decide read/write/delete dispositions.' },
  { family: 'shell', applicability: 'REQUIRED', reason: 'Profile rules match action_kind shell; destructive command detection feeds rule matching.' },
  { family: 'git', applicability: 'REQUIRED', reason: 'Profile rules match action_kind git, including destructive git operations.' },
  { family: 'http', applicability: 'REQUIRED', reason: 'Profile rules match action_kind http and gate authenticated mutations and egress.' },
  { family: 'mcp', applicability: 'REQUIRED', reason: 'Profile rules match action_kind mcp and gate consequential downstream tool calls.' },
  { family: 'delegation', applicability: 'REQUIRED', reason: 'Profile rules match action_kind delegation and decide whether sub-agent spawning is governed.' },
  { family: 'memory', applicability: 'REQUIRED', reason: 'profile.memory_write_policy and profile.minimum_memory_confidence are read directly by verifyCandidateMemory.' },
  { family: 'sensitive_paths', applicability: 'REQUIRED', reason: 'Rules match the sensitive_path fact, so a bundle can stop treating credential paths as sensitive.' },
  { family: 'governance_config', applicability: 'REQUIRED', reason: 'Rules match the governance_config fact, so a bundle can stop protecting SafeLoop"s own control plane.' },
  { family: 'workspace_boundary', applicability: 'REQUIRED', reason: 'Rules match the workspace relation fact, so a bundle decides how out-of-workspace side effects are gated.' },
  { family: 'budgets', applicability: 'REQUIRED', reason: 'profile.budgets is passed verbatim to createBudgetTracker, which is the pre-execution admission check.' },
  {
    family: 'custom',
    applicability: 'NOT_APPLICABLE',
    reason: 'action_kind custom is an open extension point with no fixed operation semantics. SafeLoop ships no canonical dangerous exemplar for it, so any control would assert invented policy behavior rather than a real invariant. Rules matching custom are still evaluated at runtime by the same rule engine the other families exercise.',
  },
  {
    family: 'breaker',
    applicability: 'NOT_APPLICABLE',
    reason: 'GovernanceProfile declares no circuit-breaker fields. runtimeCore constructs the breaker with createRuntimeCircuitBreaker({ storageOptions }) and the thresholds are code defaults (maxRepeatedToolCalls 3, maxDeniedActions 2, maxFailures 3). No candidate bundle can raise, lower, or disable them, so breaker behavior is not lifecycle-gated.',
  },
  {
    family: 'permit',
    applicability: 'NOT_APPLICABLE',
    reason: 'Permit issuance and redemption are HMAC-signed over fixed claims and verified in executionPermit.ts against a runtime secret. GovernanceProfile contributes no permit field, so a candidate bundle cannot weaken permit validation.',
  },
  {
    family: 'execution_context',
    applicability: 'NOT_APPLICABLE',
    reason: 'Workspace relation, workspace root, and execution cwd are resolved at proposal time and signed into the permit; the executor re-resolves and compares them in code. A bundle cannot alter that comparison. The part a bundle does control is which workspace relation is gated, and that is covered by the workspace_boundary family.',
  },
];

interface GoldenPolicyControlSpec {
  id: string;
  family: string;
  polarity: 'positive' | 'negative';
  expected: string[];
  /** Exercises the production governance path and returns the observed outcome token. */
  probe: (profile: GovernanceProfile) => string;
}

const GOLDEN_WORKSPACE = '/tmp/safeloop-phase6-workspace';

function dispositionProbe(action: Record<string, unknown>, workspace = GOLDEN_WORKSPACE) {
  return (profile: GovernanceProfile): string =>
    evaluateProfile(profile, canonicalizeAction(action as never), workspace).disposition;
}

const GATED = ['DENY', 'STOP_AGENT', 'REQUIRE_APPROVAL', 'PAUSE'];
const PERMITTED = ['ALLOW', 'ALLOW_WITH_WARNING', 'REQUIRE_APPROVAL'];
/** Not a policy limit: the bounded work this control will do to prove a budget binds. */
const BUDGET_PROBE_CEILING = 10_000;

const GOLDEN_CONTROL_MANIFEST: GoldenPolicyControlSpec[] = [
  {
    id: 'filesystem.safe_read_permitted',
    family: 'filesystem',
    polarity: 'positive',
    expected: PERMITTED,
    probe: dispositionProbe({ action_kind: 'filesystem', operation: 'read', target: 'safe.txt', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'filesystem.sensitive_delete_gated',
    family: 'filesystem',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'filesystem', operation: 'delete', target: '/etc/passwd', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'sensitive_paths.credential_read_gated',
    family: 'sensitive_paths',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'filesystem', operation: 'read', target: '/etc/shadow', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'governance_config.write_gated',
    family: 'governance_config',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'filesystem', operation: 'overwrite', target: `${GOLDEN_WORKSPACE}/.safeloop/policy-lifecycle.json`, arguments: { content: '{}' }, agent_id: 'golden-agent' }),
  },
  {
    id: 'workspace_boundary.outside_write_gated',
    family: 'workspace_boundary',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'filesystem', operation: 'create', target: '/tmp/safeloop-outside-approval.txt', arguments: { content: 'x' }, agent_id: 'golden-agent' }),
  },
  {
    id: 'shell.destructive_command_gated',
    family: 'shell',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'shell', operation: 'run', arguments: { command: 'rm -rf /tmp/safeloop-danger' }, agent_id: 'golden-agent' }),
  },
  {
    id: 'http.authenticated_mutation_gated',
    family: 'http',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'http', operation: 'authenticated_mutation', method: 'POST', resource: 'https://evil.example/mutate', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'git.force_push_gated',
    family: 'git',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'git', operation: 'force_push', target: 'origin/master', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'mcp.dangerous_tool_gated',
    family: 'mcp',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'mcp', operation: 'call_tool', tool: 'delete_repository', arguments: { repository: 'prod' }, agent_id: 'golden-agent' }),
  },
  {
    // camelCase is the naming style Phase 6.3 missed entirely; the golden set
    // now proves the classifier survives lowercasing canonicalization.
    id: 'mcp.camelcase_dangerous_tool_gated',
    family: 'mcp',
    polarity: 'negative',
    expected: GATED,
    probe: dispositionProbe({ action_kind: 'mcp', operation: 'call_tool', tool: 'deleteRepository', arguments: { repository: 'prod' }, agent_id: 'golden-agent' }),
  },
  {
    /*
     * Digit-led destructive exemplar.
     *
     * Phase 6.4 preserved verbs across camelCase but not across a digit that
     * immediately follows the verb: `delete2FADevice` segmented as
     * delete2 | fa | device and lost the action entirely. This control fails
     * if that boundary rule regresses, so the class cannot silently return.
     */
    id: 'mcp.digit_boundary_dangerous_tool_gated',
    family: 'mcp',
    polarity: 'negative',
    // Asserts the classification fact as well as the disposition. A
    // disposition-only control cannot detect a classifier regression under a
    // profile whose default_disposition already gates everything (strict-local
    // holds every MCP call), which would leave the regression invisible there.
    expected: ['CONSEQUENTIAL_AND_GATED'],
    probe: (profile) => {
      const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool: 'delete2FADevice', arguments: { device: 'primary' }, agent_id: 'golden-agent' } as never);
      const classified = action.mcp_consequential === true;
      const gated = GATED.includes(evaluateProfile(profile, action, GOLDEN_WORKSPACE).disposition);
      if (!classified) return 'NOT_CLASSIFIED_CONSEQUENTIAL';
      return gated ? 'CONSEQUENTIAL_AND_GATED' : 'CLASSIFIED_BUT_NOT_GATED';
    },
  },
  {
    id: 'mcp.benign_tool_not_over_gated',
    family: 'mcp',
    polarity: 'positive',
    expected: ['ALLOW', 'ALLOW_WITH_WARNING', 'REQUIRE_APPROVAL'],
    probe: dispositionProbe({ action_kind: 'mcp', operation: 'call_tool', tool: 'list_resources', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    /*
     * Over-gating control, stated relative to the profile's own baseline.
     *
     * An absolute expectation cannot express this: strict-local holds every MCP
     * call for approval by design, so "must not be REQUIRE_APPROVAL" would fail
     * a legitimately strict profile. What must never happen is a benign
     * near-match being treated MORE severely than a plainly benign call - that
     * is exactly the Phase 6.2 substring regression.
     */
    id: 'mcp.benign_near_match_not_over_gated',
    family: 'mcp',
    polarity: 'positive',
    expected: ['NOT_ESCALATED'],
    probe: (profile) => {
      const at = (tool: string) => evaluateProfile(
        profile,
        canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool, arguments: {}, agent_id: 'golden-agent' } as never),
        GOLDEN_WORKSPACE,
      ).disposition;
      const baseline = at('list_resources');
      const nearMatch = at('weather_delete_status');
      if (nearMatch === baseline) return 'NOT_ESCALATED';
      return moreSevere(nearMatch, baseline) === nearMatch ? 'ESCALATED_OVER_BASELINE' : 'NOT_ESCALATED';
    },
  },
  {
    id: 'delegation.subagent_governed',
    family: 'delegation',
    polarity: 'negative',
    // A bundle may allow delegation, but it must not become an ungoverned plain
    // ALLOW: sub-agent spawning has to stay at least recorded/warned.
    expected: ['ALLOW_WITH_WARNING', ...GATED],
    probe: dispositionProbe({ action_kind: 'delegation', operation: 'spawn', target: 'subagent', arguments: {}, agent_id: 'golden-agent' }),
  },
  {
    id: 'memory.low_confidence_not_durably_allowed',
    family: 'memory',
    polarity: 'negative',
    // Exercises verifyCandidateMemory exactly as runtimeCore wires it.
    expected: ['QUARANTINE', 'REJECT', 'REQUIRE_REVIEW'],
    probe: (profile) => verifyCandidateMemory(
      {
        memory_id: 'golden-memory-low-confidence',
        memory_type: 'procedural',
        situation: 'A golden control probe for durable memory admission.',
        lesson: 'Low-confidence memory must not be durably written without review.',
        confidence: 0,
        evidence: ['golden-evidence'],
      } as never,
      {
        scenario: { scenarioId: profile.id, memoryWritePolicy: profile.memory_write_policy } as never,
        minimumConfidence: profile.minimum_memory_confidence,
      },
    ).decision,
  },
  {
    id: 'budgets.action_budget_binds',
    family: 'budgets',
    polarity: 'negative',
    expected: ['BUDGET_BINDS'],
    probe: (profile) => {
      const limits = profile.budgets ?? {};
      const limit = limits.maximum_actions;
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 'NO_ACTION_BUDGET';
      if (limit > BUDGET_PROBE_CEILING) {
        // Cannot be demonstrated within bounded work, so it is not proven to bind.
        return 'BUDGET_NOT_DEMONSTRABLE';
      }
      const tracker = createBudgetTracker(limits);
      if (!tracker.check().permitted) return 'BUDGET_DENIES_IMMEDIATELY';
      for (let i = 0; i < limit; i += 1) tracker.recordAction();
      const verdict = tracker.check();
      return verdict.permitted ? 'BUDGET_DOES_NOT_BIND' : 'BUDGET_BINDS';
    },
  },
];

function goldenControls(profile: GovernanceProfile): GoldenPolicyControlsResult {
  const declaredFamilies = new Set(GOVERNANCE_CONTROL_FAMILIES.map((entry) => entry.family));
  const requiredFamilies = GOVERNANCE_CONTROL_FAMILIES.filter((entry) => entry.applicability === 'REQUIRED').map((entry) => entry.family);
  const coverageErrors: string[] = [];

  // A family the evaluator can dispatch on but the manifest never mentions is a
  // silent omission, which is exactly the Phase 6.2 false-green condition.
  for (const kind of GOVERNANCE_ACTION_KINDS) {
    if (!declaredFamilies.has(kind)) coverageErrors.push(`family_not_declared:${kind}`);
  }
  const seen = new Set<string>();
  for (const spec of GOLDEN_CONTROL_MANIFEST) {
    if (seen.has(spec.id)) coverageErrors.push(`duplicate_control_id:${spec.id}`);
    seen.add(spec.id);
    if (!declaredFamilies.has(spec.family)) coverageErrors.push(`control_family_not_declared:${spec.family}`);
    const declaration = GOVERNANCE_CONTROL_FAMILIES.find((entry) => entry.family === spec.family);
    if (declaration?.applicability === 'NOT_APPLICABLE') coverageErrors.push(`control_declared_not_applicable:${spec.family}`);
    if (!spec.expected.length) coverageErrors.push(`control_expected_undeterminable:${spec.id}`);
  }
  for (const family of requiredFamilies) {
    if (!GOLDEN_CONTROL_MANIFEST.some((spec) => spec.family === family)) coverageErrors.push(`required_family_has_no_control:${family}`);
  }

  const controls: GoldenPolicyControlResult[] = GOLDEN_CONTROL_MANIFEST.map((spec) => {
    const base = { id: spec.id, family: spec.family, polarity: spec.polarity, applicability: 'REQUIRED' as const, expected: spec.expected };
    let observed: string;
    try {
      observed = spec.probe(profile);
    } catch (error) {
      return { ...base, observed: 'ERROR', status: 'error' as const, detail: redactSecrets(error instanceof Error ? error.message : String(error)) };
    }
    if (typeof observed !== 'string' || !observed) return { ...base, observed: 'UNKNOWN', status: 'unknown' as const, detail: 'control produced no determinable outcome' };
    return { ...base, observed, status: spec.expected.includes(observed) ? 'pass' as const : 'fail' as const };
  });

  const executed = controls.map((entry) => entry.id);
  const coveredFamilies = new Set(controls.filter((entry) => entry.status === 'pass').map((entry) => entry.family));
  const missingProven = requiredFamilies.filter((family) => !coveredFamilies.has(family));
  const allRequiredPassed = coverageErrors.length === 0
    && controls.length === GOLDEN_CONTROL_MANIFEST.length
    && controls.every((entry) => entry.status === 'pass');

  return {
    control_set_version: GOLDEN_CONTROL_SET_VERSION,
    families: [...GOVERNANCE_CONTROL_FAMILIES],
    required_control_ids: GOLDEN_CONTROL_MANIFEST.map((spec) => spec.id),
    executed_control_ids: executed,
    coverage_errors: coverageErrors,
    coverage_complete: coverageErrors.length === 0 && missingProven.length === 0,
    positive_pass: controls.filter((entry) => entry.polarity === 'positive').every((entry) => entry.status === 'pass'),
    negative_pass: controls.filter((entry) => entry.polarity === 'negative').every((entry) => entry.status === 'pass'),
    all_required_passed: allRequiredPassed,
    controls,
  };
}
function buildPolicyValidationResult(bundle: PolicyBundle): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (bundle.schema_version !== SUPPORTED_SCHEMA_VERSION) errors.push('unsupported_policy_bundle_schema_version');
  try { verifyBundleIntegrity(bundle); } catch { errors.push('policy_bundle_hash_mismatch'); }
  try {
    assertPolicyInputWithinLimits(bundle.profile, bundle.metadata);
    validateProfile(bundle.profile);
  } catch (error) {
    errors.push(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
  if (!bundle.profile.rules?.length) errors.push('profile_has_no_rules');
  errors.push(...validateLifecycleProfile(bundle.profile));
  const golden = goldenControls(bundle.profile);
  // Fail closed on incomplete proof, not only on a failing control.
  if (golden.control_set_version !== GOLDEN_CONTROL_SET_VERSION) errors.push('golden_control_set_version_mismatch');
  for (const reason of golden.coverage_errors) errors.push(`golden_control_coverage:${reason}`);
  if (golden.executed_control_ids.length !== golden.required_control_ids.length) errors.push('golden_control_manifest_incomplete');
  if (!golden.coverage_complete) errors.push('golden_control_coverage_incomplete');
  for (const control of golden.controls) {
    if (control.status === 'error') errors.push(`golden_control_errored:${control.id}`);
    else if (control.status === 'unknown') errors.push(`golden_control_undeterminable:${control.id}`);
    else if (control.status === 'fail') errors.push(`golden_control_failed:${control.id}`);
  }
  if (!golden.positive_pass) errors.push('positive_golden_control_failed');
  if (!golden.negative_pass) errors.push('negative_golden_control_failed');
  if (!golden.all_required_passed) errors.push('required_golden_controls_not_all_passed');
  return {
    validation_id: `validation-${Date.now()}-${bundle.content_hash.slice(7, 15)}`,
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    validated_at: now(),
    valid: errors.length === 0,
    errors,
    warnings,
    control_set_version: GOLDEN_CONTROL_SET_VERSION,
    golden_controls: golden,
  };
}

function appendValidation(store: PolicyLifecycleStore, bundle: PolicyBundle, actor: string, options: SafeloopStorageOptions): PolicyValidationResult {
  const result = buildPolicyValidationResult(bundle);
  store.validations.push(result);
  bundle.status = result.valid ? (['APPROVED', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'].includes(bundle.status) ? bundle.status : 'VALIDATED') : 'INVALID';
  recordLifecycleEvent(store, {
    type: result.valid ? 'policy.bundle.validated' : 'policy.bundle.validation_failed',
    actor: sanitizeIdentity(actor),
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    tenant_id: bundle.tenant_id,
    summary: result.valid ? `Policy bundle validated: ${bundle.profile_id}@${bundle.version}` : `Policy bundle validation failed: ${bundle.profile_id}@${bundle.version}`,
    detail: { validation: result, prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
  }, options);
  return result;
}

export function validatePolicyBundle(bundleId: string, actor: string, options: SafeloopStorageOptions = {}): PolicyValidationResult {
  return withLifecycleMutation(options, (store) => {
    const bundle = store.bundles.find((entry) => entry.bundle_id === bundleId);
    if (!bundle) throw new Error('policy_bundle_not_found');
    return mutationResult(appendValidation(store, bundle, actor, options));
  });
}

export function approvePolicyBundle(bundleId: string, actor: string, options: SafeloopStorageOptions = {}): PolicyBundle {
  return withLifecycleMutation(options, (store) => {
    const bundle = store.bundles.find((entry) => entry.bundle_id === bundleId);
    if (!bundle) throw new Error('policy_bundle_not_found');
    if (bundle.status === 'APPROVED') return mutationResult(bundle, false);
    if (bundle.status !== 'VALIDATED') throw new Error(`invalid_policy_lifecycle_transition:${bundle.status}->APPROVED`);
    bundle.status = 'APPROVED';
    recordLifecycleEvent(store, {
      type: 'policy.bundle.approved',
      actor: sanitizeIdentity(actor),
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      tenant_id: bundle.tenant_id,
      summary: `Policy bundle approved: ${bundle.profile_id}@${bundle.version}`,
      detail: { prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
    }, options);
    return mutationResult(bundle);
  });
}

function activateBundleInStore(store: PolicyLifecycleStore, input: {
  bundle_id: string;
  actor: string;
  approved_by: string;
  request_id: string;
  reason?: string;
  tenant_id?: string;
  rollback_from_bundle_id?: string;
}, options: SafeloopStorageOptions): PolicyActivationRecord {
  const existingId = store.idempotency[input.request_id];
  if (existingId) {
    const existing = store.activations.find((entry) => entry.activation_id === existingId);
    if (existing) return existing;
  }
  const bundle = store.bundles.find((entry) => entry.bundle_id === input.bundle_id && (!input.tenant_id || entry.tenant_id === input.tenant_id));
  if (!bundle) throw new Error('policy_bundle_not_found');
  if (bundle.tenant_id && input.tenant_id && bundle.tenant_id !== input.tenant_id) throw new Error('cross_tenant_policy_activation_denied');
  const alreadyActive = activeFor(store, bundle.profile_id);
  if (alreadyActive?.bundle_id === bundle.bundle_id && !input.rollback_from_bundle_id) {
    const existing = store.activations.find((entry) => entry.activation_id === alreadyActive.activation_id);
    if (existing) {
      store.idempotency[input.request_id] = existing.activation_id;
      return existing;
    }
  }
  const validation = appendValidation(store, bundle, input.actor, options);
  if (!validation.valid) throw new Error('policy_validation_failed');
  if (bundle.status !== 'APPROVED' && bundle.status !== 'ACTIVE' && bundle.status !== 'SUPERSEDED' && bundle.status !== 'ROLLED_BACK') {
    throw new Error(`policy_bundle_not_approved:${bundle.status}`);
  }
  const previous = activeFor(store, bundle.profile_id);
  const previousBundle = previous ? store.bundles.find((entry) => entry.bundle_id === previous.bundle_id) : undefined;
  const snapshot = buildConfigSnapshot(bundle, input.actor);
  if (!store.config_snapshots.some((entry) => entry.snapshot_id === snapshot.snapshot_id)) store.config_snapshots.push(snapshot);
  for (const entry of store.bundles) {
    if (entry.bundle_id === bundle.bundle_id) entry.status = 'ACTIVE';
    else if (entry.profile_id === bundle.profile_id && entry.status === 'ACTIVE') entry.status = input.rollback_from_bundle_id ? 'ROLLED_BACK' : 'SUPERSEDED';
  }
  const activation: PolicyActivationRecord = {
    activation_id: `activation-${Date.now()}-${bundle.content_hash.slice(7, 15)}`,
    request_id: input.request_id,
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    config_snapshot_id: snapshot.snapshot_id,
    previous_bundle_id: previous?.bundle_id,
    previous_config_snapshot_id: previous?.config_snapshot_id,
    actor: sanitizeIdentity(input.actor),
    approved_by: sanitizeIdentity(input.approved_by),
    approved_at: now(),
    activated_at: now(),
    validation_id: validation.validation_id,
    golden_controls_passed: validation.golden_controls.all_required_passed,
    control_set_version: validation.control_set_version,
    control_manifest: validation.golden_controls,
    reason: redactSecrets(input.reason ?? ''),
    rollback_from_bundle_id: input.rollback_from_bundle_id,
  };
  setActiveFor(store, bundle.profile_id, {
    bundle_id: bundle.bundle_id,
    config_snapshot_id: snapshot.snapshot_id,
    activated_at: activation.activated_at,
    activation_id: activation.activation_id,
    profile_id: bundle.profile_id,
  });
  store.activations.push(activation);
  store.idempotency[input.request_id] = activation.activation_id;
  if (previousBundle && previousBundle.bundle_id !== bundle.bundle_id) {
    recordLifecycleEvent(store, {
      type: input.rollback_from_bundle_id ? 'policy.rollback.initiated' : 'policy.bundle.superseded',
      actor: sanitizeIdentity(input.actor),
      bundle_id: input.rollback_from_bundle_id ? bundle.bundle_id : previousBundle.bundle_id,
      bundle_version: input.rollback_from_bundle_id ? bundle.version : previousBundle.version,
      config_snapshot_id: previous?.config_snapshot_id,
      previous_bundle_id: previousBundle.bundle_id,
      previous_config_snapshot_id: previous?.config_snapshot_id,
      tenant_id: bundle.tenant_id,
      summary: input.rollback_from_bundle_id ? `Policy rollback initiated to ${bundle.bundle_id}` : `Policy bundle superseded: ${previousBundle.profile_id}@${previousBundle.version}`,
      detail: { reason: input.reason, prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
    }, options);
  }
  recordLifecycleEvent(store, {
    type: input.rollback_from_bundle_id ? 'policy.rollback.completed' : 'policy.bundle.activated',
    actor: sanitizeIdentity(input.actor),
    bundle_id: bundle.bundle_id,
    bundle_version: bundle.version,
    config_snapshot_id: snapshot.snapshot_id,
    previous_bundle_id: previous?.bundle_id,
    previous_config_snapshot_id: previous?.config_snapshot_id,
    tenant_id: bundle.tenant_id,
    summary: input.rollback_from_bundle_id ? `Policy rollback completed to ${bundle.version}` : `Policy bundle activated: ${bundle.profile_id}@${bundle.version}`,
    detail: { validation_id: validation.validation_id, golden_controls_passed: activation.golden_controls_passed, reason: activation.reason, prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
  }, options);
  return activation;
}

export function activatePolicyBundle(input: {
  bundle_id: string;
  actor: string;
  approved_by: string;
  request_id?: string;
  reason?: string;
  tenant_id?: string;
}, options: SafeloopStorageOptions = {}): PolicyActivationRecord {
  return withLifecycleMutation(options, (store) => {
    const requestId = input.request_id ?? `activation:${input.bundle_id}`;
    const beforeCount = store.activations.length;
    const activation = activateBundleInStore(store, {
      bundle_id: input.bundle_id,
      actor: input.actor,
      approved_by: input.approved_by,
      request_id: requestId,
      reason: input.reason,
      tenant_id: input.tenant_id,
    }, options);
    return mutationResult(activation, store.activations.length !== beforeCount);
  });
}

export function rollbackPolicy(input: {
  target_bundle_id: string;
  actor: string;
  approved_by: string;
  reason: string;
  request_id?: string;
  tenant_id?: string;
}, options: SafeloopStorageOptions = {}): PolicyActivationRecord {
  return withLifecycleMutation(options, (store) => {
    const target = store.bundles.find((entry) => entry.bundle_id === input.target_bundle_id && (!input.tenant_id || entry.tenant_id === input.tenant_id));
    if (!target) throw new Error('policy_bundle_not_found');
    const active = activeFor(store, target.profile_id);
    if (active?.bundle_id === target.bundle_id) {
      const existing = store.activations.find((entry) => entry.activation_id === active.activation_id);
      if (existing) return mutationResult(existing, false);
    }
    const requestId = input.request_id ?? `rollback:${active?.bundle_id ?? 'none'}:${input.target_bundle_id}`;
    const beforeCount = store.activations.length;
    const activation = activateBundleInStore(store, {
      bundle_id: input.target_bundle_id,
      actor: input.actor,
      approved_by: input.approved_by,
      request_id: requestId,
      reason: input.reason,
      tenant_id: input.tenant_id,
      rollback_from_bundle_id: active?.bundle_id,
    }, options);
    return mutationResult(activation, store.activations.length !== beforeCount);
  });
}

export function ensureBaselinePolicyLifecycle(profileId: string, actor = 'safeloop-runtime', options: SafeloopStorageOptions = {}): PolicyLifecycleStatus {
  withLifecycleMutation(options, (store) => {
    if (activeFor(store, profileId)) return mutationResult(undefined, false);
    const profile = loadProfile(profileId);
    assertPolicyInputWithinLimits(profile, { imported_from: 'profiles directory' });
    const safeProfile = profileContent(profile);
    const contentHash = stableHash(bundleContent(safeProfile, profileId));
    let bundle = store.bundles.find((entry) => entry.bundle_id === `policy-${profileId}-${contentHash.slice(7, 19)}` && entry.version === `baseline-${profileId}`);
    if (!bundle) {
      bundle = {
        schema_version: 1,
        bundle_id: `policy-${profileId}-${contentHash.slice(7, 19)}`,
        version: `baseline-${profileId}`,
        profile_id: profileId,
        created_at: now(),
        created_by: sanitizeIdentity(actor),
        content_hash: contentHash,
        status: 'DRAFT',
        profile: safeProfile,
        metadata: sanitize({ imported_from: 'profiles directory' }) as Record<string, unknown>,
      };
      store.bundles.push(bundle);
      recordLifecycleEvent(store, {
        type: 'policy.bundle.created',
        actor: sanitizeIdentity(actor),
        bundle_id: bundle.bundle_id,
        bundle_version: bundle.version,
        summary: `Policy bundle created: ${bundle.profile_id}@${bundle.version}`,
        detail: { baseline_import: true, prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
      }, options);
    }
    const validation = appendValidation(store, bundle, actor, options);
    if (!validation.valid) throw new Error('policy_validation_failed');
    bundle.status = 'APPROVED';
    recordLifecycleEvent(store, {
      type: 'policy.bundle.approved',
      actor: sanitizeIdentity(actor),
      bundle_id: bundle.bundle_id,
      bundle_version: bundle.version,
      summary: `Policy bundle approved: ${bundle.profile_id}@${bundle.version}`,
      detail: { baseline_import: true, prior_revision: store.revision ?? 0, new_revision: (store.revision ?? 0) + 1 },
    }, options);
    activateBundleInStore(store, {
      bundle_id: bundle.bundle_id,
      actor,
      approved_by: actor,
      request_id: `baseline:${profileId}`,
      reason: 'import existing effective profile as immutable baseline',
    }, options);
    return mutationResult(undefined);
  });
  return policyLifecycleStatus(options, profileId);
}

export function activePolicyProvenance(profileId: string, options: SafeloopStorageOptions = {}): PolicyDecisionProvenance {
  const path = lifecyclePath(options);
  const mtimeMs = statSync(path).mtimeMs;
  const cacheKey = `${path}:${profileId}`;
  const cached = provenanceCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.provenance;
  const store = readExistingStore(options);
  const active = activeFor(store, profileId);
  if (!active) throw new Error('active_policy_missing');
  const bundle = store.bundles.find((entry) => entry.bundle_id === active.bundle_id);
  const config = store.config_snapshots.find((entry) => entry.snapshot_id === active.config_snapshot_id);
  if (!bundle || !config) throw new Error('active_policy_drift');
  verifyBundleIntegrity(bundle);
  verifyConfigIntegrity(config, bundle);
  if (bundle.profile_id !== profileId || config.profile_id !== profileId || active.profile_id !== profileId) throw new Error('active_policy_profile_mismatch');
  if (bundle.status !== 'ACTIVE') throw new Error('active_policy_state_mismatch');
  if (store.bundles.filter((entry) => entry.profile_id === profileId && entry.status === 'ACTIVE').length !== 1) throw new Error('duplicate_active_policy_state');
  const provenance: PolicyDecisionProvenance = {
    policy_bundle_id: bundle.bundle_id,
    policy_bundle_version: bundle.version,
    policy_hash: bundle.content_hash,
    config_snapshot_id: config.snapshot_id,
    config_hash: config.content_hash,
    runtime_version: POLICY_RUNTIME_VERSION,
    protocol_version: PROTOCOL_VERSION,
    event_schema_version: 1,
    profile: bundle.profile_id,
    lifecycle_revision: store.revision ?? 0,
  };
  provenanceCache.set(cacheKey, { mtimeMs, provenance });
  return provenance;
}

export function resolveHistoricalPolicyContext(provenance: PolicyDecisionProvenance, options: SafeloopStorageOptions = {}): { bundle: PolicyBundle; config: GovernanceConfigSnapshot } {
  const store = readExistingStore(options);
  const bundle = store.bundles.find((entry) => entry.bundle_id === provenance.policy_bundle_id && entry.content_hash === provenance.policy_hash);
  const config = store.config_snapshots.find((entry) => entry.snapshot_id === provenance.config_snapshot_id && entry.content_hash === provenance.config_hash);
  try {
    if (!bundle || !config) throw new Error('missing_historical_context');
    verifyBundleIntegrity(bundle);
    verifyConfigIntegrity(config, bundle);
    if (bundle.profile_id !== provenance.profile || config.profile_id !== provenance.profile) throw new Error('historical_profile_mismatch');
    return { bundle, config };
  } catch {
    throw new Error('historical_policy_context_not_resolvable');
  }
}

export function detectPolicyDrift(options: SafeloopStorageOptions = {}): { state: PolicyDriftState; reasons: string[] } {
  const state = readStoreState(options);
  if (state.state === 'STORE_NOT_INITIALIZED') return { state: 'DRIFT', reasons: ['active_policy_missing'] };
  if (state.state !== 'STORE_VALID' || !state.store) return { state: 'UNKNOWN', reasons: [state.error ?? state.state] };
  const store = state.store;
  const reasons: string[] = [];
  const activeMap = store.active_by_profile ?? {};
  if (Object.keys(activeMap).length === 0) reasons.push('active_policy_missing');
  for (const [profileId, active] of Object.entries(activeMap)) {
    const bundle = store.bundles.find((entry) => entry.bundle_id === active.bundle_id);
    const config = store.config_snapshots.find((entry) => entry.snapshot_id === active.config_snapshot_id);
    if (!bundle) { reasons.push(`${profileId}:active_bundle_missing`); continue; }
    if (!config) { reasons.push(`${profileId}:active_config_snapshot_missing`); continue; }
    try { verifyBundleIntegrity(bundle); } catch (error) { reasons.push(`${profileId}:${error instanceof Error ? error.message : String(error)}`); }
    try { verifyConfigIntegrity(config, bundle); } catch (error) { reasons.push(`${profileId}:${error instanceof Error ? error.message : String(error)}`); }
    if (bundle.profile_id !== profileId || config.profile_id !== profileId || active.profile_id !== profileId) reasons.push(`${profileId}:active_policy_profile_mismatch`);
    if (store.bundles.filter((entry) => entry.profile_id === profileId && entry.status === 'ACTIVE').length !== 1) reasons.push(`${profileId}:duplicate_active_policy_state`);
  }
  return { state: reasons.length ? 'DRIFT' : 'NO_DRIFT', reasons };
}

export function policyLifecycleStatus(options: SafeloopStorageOptions = {}, profileId?: string): PolicyLifecycleStatus {
  const state = readStoreState(options);
  if (state.state !== 'STORE_VALID' || !state.store) {
    return {
      store_state: state.state,
      revision: 0,
      active_by_profile: {},
      drift_state: state.state === 'STORE_NOT_INITIALIZED' ? 'DRIFT' : 'UNKNOWN',
      drift_reasons: [state.error ?? state.state],
      bundle_count: 0,
      config_snapshot_count: 0,
    };
  }
  const store = state.store;
  const selectedProfile = profileId ?? Object.keys(store.active_by_profile ?? {})[0];
  const active = selectedProfile ? activeFor(store, selectedProfile) : store.active;
  const activeBundle = active ? store.bundles.find((entry) => entry.bundle_id === active.bundle_id) : undefined;
  const activeConfig = active ? store.config_snapshots.find((entry) => entry.snapshot_id === active.config_snapshot_id) : undefined;
  const drift = detectPolicyDrift(options);
  return {
    store_state: 'STORE_VALID',
    revision: store.revision ?? 0,
    active_by_profile: sanitize(store.active_by_profile ?? {}) as Record<string, { bundle_id: string; config_snapshot_id: string; activated_at: string; activation_id: string; profile_id?: string }>,
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

export function policyLifecycleFileExists(options: SafeloopStorageOptions = {}): boolean {
  return existsSync(lifecyclePath(options));
}
