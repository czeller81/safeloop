import { createHash } from 'crypto';
import { appendEvent } from './eventStream';
import type { SafeloopStorageOptions } from './localStorage';

export type SpecialistId = 'video_director' | 'coding' | 'operations' | 'sales' | 'general';
export type SpecialistTool = 'terminal' | 'filesystem' | 'video_mcp' | 'analysis' | 'messaging' | 'publishing';
export type SpecialistDecision = 'ALLOW' | 'DENY' | 'REQUIRES_APPROVAL';
export type ReasonCode =
  | 'specialist-tool-not-permitted'
  | 'specialist-identity-mismatch'
  | 'unknown-specialist'
  | 'protected-area-write'
  | 'approval-required'
  | 'command-risk-block'
  | 'authorization-context-mismatch'
  | 'enforcement-adapter-missing'
  | 'effect-mediated'
  | 'effect-unmediated';

export type EffectClass =
  | 'filesystem_write'
  | 'filesystem_delete'
  | 'terminal_execute'
  | 'external_api_call'
  | 'external_message'
  | 'publish'
  | 'deploy'
  | 'credential_change'
  | 'dns_change'
  | 'purchase'
  | 'database_write'
  | 'production_change';

export interface RouteSpecialistTaskInput {
  objective: string;
  requiresInfrastructureSupport?: boolean;
  preferredSupportSpecialist?: 'coding' | 'operations';
}

export interface RouteSpecialistTaskResult {
  specialistId: SpecialistId;
  score: number;
  reasons: string[];
  delegatedSupport?: SpecialistId;
}

export interface SpecialistToolValidation {
  allowed: boolean;
  specialistId: SpecialistId;
  tool: SpecialistTool;
  reasonCodes: ReasonCode[];
  message: string;
}

export interface SpecialistActionInput {
  specialistId: SpecialistId | string;
  actionKind?: string;
  command?: string;
  tool?: SpecialistTool;
  environment?: 'development' | 'staging' | 'production' | string;
  target?: string;
  taskId?: string;
  executionPlanId?: string;
  stepId?: string;
  authorizationToken?: string;
}

export interface SpecialistActionDecision {
  decision: SpecialistDecision;
  specialistId: string;
  tool: SpecialistTool;
  reasonCodes: ReasonCode[];
  reasons: string[];
  authorizationToken?: string;
  contextFingerprint: string;
}

export type SpecialistReviewStatus = 'approved' | 'needs_changes' | 'failed' | 'rejected';

export interface SpecialistReviewInput {
  specialistId?: string;
  reviewerId?: string;
  status?: SpecialistReviewStatus | string;
  summary?: string;
  recommendedNextStep?: string;
  buildResults?: unknown[];
  testsRun?: unknown[];
  unresolvedIssues?: unknown[];
  artifacts?: unknown[];
  evidence?: unknown[];
  storageOptions?: SafeloopStorageOptions;
}

export interface SpecialistReviewValidationError {
  field: string;
  expectedType: string;
  required: boolean;
  message: string;
}

export interface SpecialistReviewResult {
  ok: boolean;
  eventId?: string;
  errors?: SpecialistReviewValidationError[];
}

export interface DelegatedSpecialistStepInput {
  fromSpecialistId: string;
  toSpecialistId: SpecialistId;
  taskId: string;
  executionPlanId: string;
  stepId: string;
  reason: string;
  tool?: SpecialistTool;
  command?: string;
  environment?: string;
  storageOptions?: SafeloopStorageOptions;
}

export interface DelegatedSpecialistStepResult {
  ok: boolean;
  eventId: string;
  authorizationToken: string;
}

export interface EffectGuardInput<T = unknown> {
  specialistId: SpecialistId | string;
  effectClass: EffectClass;
  action: string;
  environment?: string;
  target?: string;
  metadata?: Record<string, unknown>;
  execute?: () => T;
}

export interface EffectGuardResult<T = unknown> {
  status: 'mediated' | 'unmediated' | 'blocked' | 'approval_required' | 'allowed';
  decision: SpecialistDecision;
  executed: boolean;
  result?: T;
  reasonCodes: ReasonCode[];
  eventId: string;
}

export interface EffectGuardConfig {
  baseDir?: string;
  storageOptions?: SafeloopStorageOptions;
  registeredAdapters?: EffectClass[];
  expectedAdapters?: EffectClass[];
}

export interface EnforcementStatus {
  registeredAdapters: EffectClass[];
  expectedAdapters: EffectClass[];
  knownCoverageGaps: EffectClass[];
  boundary: string;
}

const SPECIALISTS: Record<SpecialistId, { tools: SpecialistTool[] }> = {
  video_director: { tools: ['video_mcp', 'analysis'] },
  coding: { tools: ['terminal', 'filesystem', 'analysis'] },
  operations: { tools: ['terminal', 'filesystem', 'analysis'] },
  sales: { tools: ['analysis', 'messaging'] },
  general: { tools: ['analysis'] },
};

const VIDEO_TERMS = [
  'video', 'media', 'scene', 'shot', 'transcription', 'transcribe', 'proxy',
  'edit plan', 'captions', 'quality control', 'rendering', 'render',
  'video director', 'mcp tools', 'visual-only', 'visual only',
];

const APPROVAL_EFFECTS = new Set<EffectClass>([
  'external_message',
  'publish',
  'deploy',
  'credential_change',
  'dns_change',
  'purchase',
  'production_change',
]);

function generateEventId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSpecialistId(value: string): value is SpecialistId {
  return Object.prototype.hasOwnProperty.call(SPECIALISTS, value);
}

function inferTool(input: SpecialistActionInput): SpecialistTool {
  if (input.tool) return input.tool;
  if (input.command) return 'terminal';
  if (input.actionKind === 'command' || input.actionKind === 'terminal') return 'terminal';
  if (input.actionKind === 'file_write' || input.actionKind === 'filesystem') return 'filesystem';
  if (input.actionKind === 'video' || input.actionKind === 'video_mcp') return 'video_mcp';
  return 'analysis';
}

function isRiskyCommand(command: string | undefined): boolean {
  const text = normalize(command);
  return [
    'rm -rf',
    'format c:',
    'del /s',
    'remove-item -recurse',
    'drop table',
  ].some((pattern) => text.includes(pattern));
}

function requiresApproval(input: SpecialistActionInput): boolean {
  const text = normalize([input.command, input.target, input.actionKind].filter(Boolean).join(' '));
  return input.environment === 'production' ||
    ['git push', 'deploy', 'npm publish', 'publish', 'dns', 'credential', 'purchase'].some((pattern) => text.includes(pattern));
}

function actionFingerprint(input: SpecialistActionInput & { tool: SpecialistTool }): string {
  const payload = {
    specialistId: input.specialistId,
    taskId: input.taskId ?? null,
    executionPlanId: input.executionPlanId ?? null,
    stepId: input.stepId ?? null,
    tool: input.tool,
    environment: input.environment ?? null,
    target: input.target ?? null,
    command: input.command ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createAuthorizationToken(fingerprint: string): string {
  return `sl-auth-${fingerprint.slice(0, 24)}`;
}

function authorizationMatches(token: string | undefined, fingerprint: string): boolean {
  return !token || token === createAuthorizationToken(fingerprint);
}

export function routeSpecialistTask(input: RouteSpecialistTaskInput): RouteSpecialistTaskResult {
  const objective = normalize(input.objective);
  const videoScore = VIDEO_TERMS.reduce((score, term) => score + (objective.includes(term) ? 1 : 0), 0);
  const salesScore = ['sales', 'lead', 'prospect', 'customer outreach', 'pipeline', 'deal'].reduce(
    (score, term) => score + (objective.includes(term) ? 1 : 0),
    0,
  );

  if (videoScore > 0) {
    return {
      specialistId: 'video_director',
      score: 100 + videoScore,
      reasons: ['objective contains video/media workflow signals'],
      delegatedSupport: input.requiresInfrastructureSupport ? input.preferredSupportSpecialist ?? 'coding' : undefined,
    };
  }

  if (salesScore > 0) {
    return { specialistId: 'sales', score: 50 + salesScore, reasons: ['objective contains sales workflow signals'] };
  }

  if (objective.includes('terminal') || objective.includes('code') || objective.includes('infrastructure')) {
    return { specialistId: 'coding', score: 40, reasons: ['objective requires coding or terminal-backed work'] };
  }

  return { specialistId: 'general', score: 1, reasons: ['fallback general analysis route'] };
}

export function validateSpecialistTool(specialistId: SpecialistId | string, tool: SpecialistTool): SpecialistToolValidation {
  if (!isSpecialistId(specialistId)) {
    return {
      allowed: false,
      specialistId: specialistId as SpecialistId,
      tool,
      reasonCodes: ['unknown-specialist'],
      message: `Unknown specialist: ${specialistId}`,
    };
  }

  const allowed = SPECIALISTS[specialistId].tools.includes(tool);
  return {
    allowed,
    specialistId,
    tool,
    reasonCodes: allowed ? [] : ['specialist-tool-not-permitted'],
    message: allowed ? 'Specialist may use this tool.' : `${specialistId} may not use ${tool}.`,
  };
}

export function evaluateSpecialistAction(input: SpecialistActionInput): SpecialistActionDecision {
  const tool = inferTool(input);
  const fingerprint = actionFingerprint({ ...input, tool });
  const toolValidation = validateSpecialistTool(input.specialistId, tool);

  if (!toolValidation.allowed) {
    return {
      decision: 'DENY',
      specialistId: input.specialistId,
      tool,
      reasonCodes: toolValidation.reasonCodes,
      reasons: [toolValidation.message],
      contextFingerprint: fingerprint,
    };
  }

  if (!authorizationMatches(input.authorizationToken, fingerprint)) {
    return {
      decision: 'DENY',
      specialistId: input.specialistId,
      tool,
      reasonCodes: ['authorization-context-mismatch'],
      reasons: ['Authorization token is not valid for this specialist/action context.'],
      contextFingerprint: fingerprint,
    };
  }

  if (input.command && isRiskyCommand(input.command)) {
    return {
      decision: 'DENY',
      specialistId: input.specialistId,
      tool,
      reasonCodes: ['command-risk-block'],
      reasons: ['Command matched a blocked risk pattern.'],
      contextFingerprint: fingerprint,
    };
  }

  if (requiresApproval(input)) {
    return {
      decision: 'REQUIRES_APPROVAL',
      specialistId: input.specialistId,
      tool,
      reasonCodes: ['approval-required'],
      reasons: ['Action requires human approval.'],
      authorizationToken: createAuthorizationToken(fingerprint),
      contextFingerprint: fingerprint,
    };
  }

  return {
    decision: 'ALLOW',
    specialistId: input.specialistId,
    tool,
    reasonCodes: [],
    reasons: ['Specialist action allowed.'],
    authorizationToken: createAuthorizationToken(fingerprint),
    contextFingerprint: fingerprint,
  };
}

export function reviewSpecialistResult(input: SpecialistReviewInput): SpecialistReviewResult {
  const errors: SpecialistReviewValidationError[] = [];

  function requireString(field: keyof SpecialistReviewInput): void {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push({
        field,
        expectedType: 'non-empty string',
        required: true,
        message: `${field} is required and must be a non-empty string.`,
      });
    }
  }

  function optionalArray(field: keyof SpecialistReviewInput): void {
    const value = input[field];
    if (value !== undefined && !Array.isArray(value)) {
      errors.push({
        field,
        expectedType: 'array',
        required: false,
        message: `${field} must be an array when provided.`,
      });
    }
  }

  requireString('specialistId');
  requireString('reviewerId');
  requireString('status');
  requireString('summary');
  requireString('recommendedNextStep');
  optionalArray('buildResults');
  optionalArray('testsRun');
  optionalArray('unresolvedIssues');
  optionalArray('artifacts');
  optionalArray('evidence');

  if (input.status && !['approved', 'needs_changes', 'failed', 'rejected'].includes(String(input.status))) {
    errors.push({
      field: 'status',
      expectedType: 'approved | needs_changes | failed | rejected',
      required: true,
      message: 'status must be one of approved, needs_changes, failed, rejected.',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const eventId = generateEventId('specialist-review');
  appendEvent({
    id: eventId,
    type: 'specialist.reviewed',
    agentId: input.reviewerId!,
    agentName: input.reviewerId!,
    caseId: 'specialist-review',
    summary: `Specialist review recorded for ${input.specialistId}: ${input.status}`,
    metadata: {
      specialistId: input.specialistId,
      reviewerId: input.reviewerId,
      status: input.status,
      summary: input.summary,
      recommendedNextStep: input.recommendedNextStep,
      buildResults: input.buildResults ?? [],
      testsRun: input.testsRun ?? [],
      unresolvedIssues: input.unresolvedIssues ?? [],
      artifacts: input.artifacts ?? [],
      evidence: input.evidence ?? [],
    },
  }, input.storageOptions ?? {});

  return { ok: true, eventId };
}

export function delegateSpecialistStep(input: DelegatedSpecialistStepInput): DelegatedSpecialistStepResult {
  const decision = evaluateSpecialistAction({
    specialistId: input.toSpecialistId,
    tool: input.tool,
    command: input.command,
    environment: input.environment,
    taskId: input.taskId,
    executionPlanId: input.executionPlanId,
    stepId: input.stepId,
  });
  const eventId = generateEventId('specialist-handoff');
  appendEvent({
    id: eventId,
    type: 'specialist.delegated',
    agentId: input.fromSpecialistId,
    agentName: input.fromSpecialistId,
    caseId: input.taskId,
    summary: `Delegated ${input.stepId} from ${input.fromSpecialistId} to ${input.toSpecialistId}`,
    metadata: {
      fromSpecialistId: input.fromSpecialistId,
      toSpecialistId: input.toSpecialistId,
      taskId: input.taskId,
      executionPlanId: input.executionPlanId,
      stepId: input.stepId,
      reason: input.reason,
      tool: decision.tool,
      authorizationToken: decision.authorizationToken,
      decision: decision.decision,
    },
  }, input.storageOptions ?? {});

  return { ok: true, eventId, authorizationToken: decision.authorizationToken ?? '' };
}

export function createEffectGuard(config: EffectGuardConfig = {}) {
  const registeredAdapters = new Set(config.registeredAdapters ?? []);
  const expectedAdapters = new Set(config.expectedAdapters ?? []);
  const storageOptions = config.storageOptions ?? (config.baseDir ? { baseDir: config.baseDir } : {});

  function status(): EnforcementStatus {
    const allEffects: EffectClass[] = [
      'filesystem_write',
      'filesystem_delete',
      'terminal_execute',
      'external_api_call',
      'external_message',
      'publish',
      'deploy',
      'credential_change',
      'dns_change',
      'purchase',
      'database_write',
      'production_change',
    ];
    return {
      registeredAdapters: Array.from(registeredAdapters),
      expectedAdapters: Array.from(expectedAdapters),
      knownCoverageGaps: allEffects.filter((effect) => !registeredAdapters.has(effect)),
      boundary: 'SafeLoop records and mediates effects routed through guardEffect; it does not universally intercept private tools.',
    };
  }

  function guardEffect<T = unknown>(input: EffectGuardInput<T>): EffectGuardResult<T> {
    const hasAdapter = registeredAdapters.has(input.effectClass);
    const adapterExpected = expectedAdapters.has(input.effectClass);
    const productionImpacting = input.environment === 'production' || APPROVAL_EFFECTS.has(input.effectClass);
    let decision: SpecialistDecision = 'ALLOW';
    let effectStatus: EffectGuardResult<T>['status'] = hasAdapter ? 'mediated' : 'unmediated';
    let executed = false;
    let result: T | undefined;
    const reasonCodes: ReasonCode[] = hasAdapter ? ['effect-mediated'] : ['effect-unmediated'];

    if (adapterExpected && !hasAdapter && productionImpacting) {
      decision = 'DENY';
      effectStatus = 'blocked';
      reasonCodes.push('enforcement-adapter-missing');
    } else if (APPROVAL_EFFECTS.has(input.effectClass) && input.environment !== 'development') {
      decision = 'REQUIRES_APPROVAL';
      effectStatus = 'approval_required';
      reasonCodes.push('approval-required');
    } else if (input.execute) {
      result = input.execute();
      executed = true;
      effectStatus = 'allowed';
    }

    const eventId = generateEventId('effect');
    appendEvent({
      id: eventId,
      type: 'effect.evaluated',
      agentId: input.specialistId,
      agentName: input.specialistId,
      caseId: 'effect-boundary',
      summary: `Effect ${input.effectClass}: ${effectStatus}`,
      metadata: {
        effectClass: input.effectClass,
        action: input.action,
        environment: input.environment,
        target: input.target,
        status: effectStatus,
        decision,
        mediated: hasAdapter,
        reasonCodes,
        ...(input.metadata ?? {}),
      },
    }, storageOptions);

    return { status: effectStatus, decision, executed, result, reasonCodes, eventId };
  }

  return { guardEffect, status };
}
