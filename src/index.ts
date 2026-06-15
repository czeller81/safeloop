export interface BreakerConfig {
  maxRetries?: number;
  maxRepeatedErrors?: number;
  tokenBudget?: {
    perStep?: number;
    perTask?: number;
  };
  scopeFreeze?: boolean;
}

export interface BreakerResult {
  success: boolean;
  stoppedBy: string;
  attempts: number;
  tokenEstimate: number;
  lastError: string | null;
  escalationMessage: string | null;
  auditEntries: AuditEntry[];
  data?: unknown;
}

export interface AuditEntry {
  timestamp: number;
  type:
    | 'attempt'
    | 'retry'
    | 'failure'
    | 'budget_check'
    | 'breaker_trip'
    | 'kill_switch'
    | 'escalation'
    | 'scope_denied'
    | 'scope_proposed'
    | 'token_usage';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface BreakerStatus {
  isTripped: boolean;
  isKilled: boolean;
  attempts: number;
  tripReason: string | null;
}

export interface BreakerContext {
  attempt: number;
  tokenUsed: number;
  signal: AbortSignal;
  log: (entry: {
    type: AuditEntry['type'];
    message: string;
    metadata?: Record<string, unknown>;
  }) => void;
  recordTokenUsage: (cost: number) => void;
  proposeScopeChange: (description: string, newGoals: string[]) => boolean;
}

export interface Breaker {
  run<T>(taskFn: (ctx: BreakerContext) => Promise<T>): Promise<BreakerResult>;
  trip(reason: string): void;
  reset(): void;
  status(): BreakerStatus;
  log(): AuditEntry[];
}

export type AgentRunLedgerCloseStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'escalated';

export type AgentRunLedgerValidationStatus =
  | 'passed'
  | 'failed'
  | 'skipped';

export type AgentRunLedgerApprovalDecision =
  | 'approved'
  | 'rejected'
  | 'needs_changes';

export interface AgentRunLedgerMetadata {
  runId?: string;
  agent: string;
  executor: string;
  repo: string;
  task?: string;
  allowedFiles?: string[];
  startedAt?: string;
}

export interface AgentRunLedgerCommandResult {
  exitCode?: number;
  summary?: string;
}

export interface AgentRunLedgerScopeCheck {
  ok: boolean;
  allowed?: string[] | boolean;
  requiresApproval?: boolean;
  reasons?: string[];
  violations?: string[];
  message?: string;
  oversightMode?: OversightMode;
  risk?: PolicyRisk;
}

export interface AgentRunLedgerScopeCheckInput {
  ok?: boolean;
  allowed?: string[] | boolean;
  requiresApproval?: boolean;
  reasons?: string[];
  violations?: string[];
  message?: string;
  oversightMode?: OversightMode;
  risk?: PolicyRisk;
}

export interface AgentRunLedgerApproval {
  approver: string;
  decision: AgentRunLedgerApprovalDecision;
  note?: string;
}

export interface AgentRunLedgerValidation {
  name: string;
  status: AgentRunLedgerValidationStatus;
  details?: string;
}

export interface AgentRunLedgerCommand {
  command: string;
  result?: AgentRunLedgerCommandResult;
}

export interface AgentRunLedgerPromptEvent {
  timestamp: number;
  type: 'prompt';
  data: { prompt: string };
}

export interface AgentRunLedgerCommandEvent {
  timestamp: number;
  type: 'command';
  data: { command: string; result?: AgentRunLedgerCommandResult };
}

export interface AgentRunLedgerChangedFilesEvent {
  timestamp: number;
  type: 'changed_files';
  data: { files: string[] };
}

export interface AgentRunLedgerValidationEvent {
  timestamp: number;
  type: 'validation';
  data: AgentRunLedgerValidation;
}

export interface AgentRunLedgerScopeCheckEvent {
  timestamp: number;
  type: 'scope_check';
  data: AgentRunLedgerScopeCheck;
}

export interface AgentRunLedgerApprovalEvent {
  timestamp: number;
  type: 'approval';
  data: AgentRunLedgerApproval;
}

export interface AgentRunLedgerCloseEvent {
  timestamp: number;
  type: 'close';
  data: { status: AgentRunLedgerCloseStatus };
}

export type AgentRunLedgerEvent =
  | AgentRunLedgerPromptEvent
  | AgentRunLedgerCommandEvent
  | AgentRunLedgerChangedFilesEvent
  | AgentRunLedgerValidationEvent
  | AgentRunLedgerScopeCheckEvent
  | AgentRunLedgerApprovalEvent
  | AgentRunLedgerCloseEvent;

export interface AgentRunLedgerJSON {
  metadata: AgentRunLedgerMetadata;
  status: AgentRunLedgerCloseStatus | 'open';
  closedAt: string | null;
  prompts: string[];
  commands: AgentRunLedgerCommand[];
  changedFiles: string[][];
  validations: AgentRunLedgerValidation[];
  scopeChecks: AgentRunLedgerScopeCheck[];
  approvals: AgentRunLedgerApproval[];
  events: AgentRunLedgerEvent[];
}

export interface AgentRunLedger {
  recordPrompt(prompt: string): void;
  recordCommand(
    command: string,
    result?: AgentRunLedgerCommandResult,
  ): void;
  recordChangedFiles(files: string[]): void;
  recordValidation(
    name: string,
    status: AgentRunLedgerValidationStatus,
    details?: string,
  ): void;
  recordScopeCheck(result: AgentRunLedgerScopeCheckInput): void;
  recordApproval(
    approver: string,
    decision: AgentRunLedgerApprovalDecision,
    note?: string,
  ): void;
  close(status: AgentRunLedgerCloseStatus): void;
  toJSON(): AgentRunLedgerJSON;
  toMarkdown(): string;
}

export type OversightMode = 'HITL' | 'HOTL' | 'HOOTL';

export type PolicyRisk = 'low' | 'medium' | 'high';

export interface PolicyGateConfig {
  oversightMode: OversightMode;
  allowedFiles?: string[];
  allowedCommands?: string[];
  blockedCommands?: string[];
  requireApprovalFor?: string[];
  maxRisk?: PolicyRisk;
}

export interface PolicyGateRequest {
  task: string;
  requestedFiles?: string[];
  requestedCommands?: string[];
  risk?: PolicyRisk;
  hasHumanApproval?: boolean;
}

export interface PolicyGateDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
  violations: string[];
  oversightMode: OversightMode;
  risk: PolicyRisk;
  message: string;
}

export interface PolicyGate {
  evaluate(request: PolicyGateRequest): PolicyGateDecision;
}

export const DEFAULTS = {
  maxRetries: 3,
  maxRepeatedErrors: 2,
  tokenBudget: { perStep: Infinity, perTask: Infinity },
  scopeFreeze: true,
} as const;

export const BREAKER_PRESETS = {
  conservativeCodingAgent: {
    maxRetries: 1,
    maxRepeatedErrors: 1,
    tokenBudget: { perStep: 4000, perTask: 12000 },
    scopeFreeze: true,
  },
  standardCodingAgent: {
    maxRetries: 2,
    maxRepeatedErrors: 2,
    tokenBudget: { perStep: 8000, perTask: 30000 },
    scopeFreeze: true,
  },
  exploratoryResearchAgent: {
    maxRetries: 3,
    maxRepeatedErrors: 2,
    tokenBudget: { perStep: 12000, perTask: 60000 },
    scopeFreeze: false,
  },
} satisfies Record<string, BreakerConfig>;

function mergeBreakerConfig(
  base: BreakerConfig,
  override?: BreakerConfig,
): BreakerConfig {
  return {
    ...base,
    ...override,
    tokenBudget: {
      ...base.tokenBudget,
      ...override?.tokenBudget,
    },
  };
}

export function createCodingAgentBreaker(config?: BreakerConfig): Breaker {
  return createBreaker(
    mergeBreakerConfig(BREAKER_PRESETS.standardCodingAgent, config),
  );
}

function cloneAgentRunLedgerMetadata(
  metadata: AgentRunLedgerMetadata,
): AgentRunLedgerMetadata {
  return {
    ...metadata,
    allowedFiles: metadata.allowedFiles ? [...metadata.allowedFiles] : [],
  };
}

function normalizePath(value: string): string {
  let normalized = value.split('\\').join('/').trim();
  while (normalized.includes('//')) {
    normalized = normalized.replace('//', '/');
  }
  return normalized;
}

function normalizeCommand(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function riskRank(risk: PolicyRisk): number {
  switch (risk) {
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
  }
}

function matchesAllowedFilePattern(pattern: string, file: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedFile = normalizePath(file);

  if (normalizedPattern.endsWith('/**')) {
    const base = normalizedPattern.slice(0, -3);
    return (
      normalizedFile === base ||
      normalizedFile.startsWith(`${base}/`)
    );
  }

  if (normalizedPattern.endsWith('/*')) {
    const base = normalizedPattern.slice(0, -2);
    if (!normalizedFile.startsWith(`${base}/`)) return false;
    const rest = normalizedFile.slice(base.length + 1);
    return !rest.includes('/');
  }

  return normalizedPattern === normalizedFile;
}

function matchesAnyAllowedFile(
  allowedFiles: string[],
  requestedFile: string,
): boolean {
  return allowedFiles.some((pattern) =>
    matchesAllowedFilePattern(pattern, requestedFile),
  );
}

function commandMatchesBlockedPattern(
  blockedPattern: string,
  command: string,
): boolean {
  return normalizeCommand(command).includes(normalizeCommand(blockedPattern));
}

function commandIsAllowed(
  allowedCommands: string[],
  command: string,
): boolean {
  return allowedCommands.some(
    (allowedCommand) => normalizeCommand(allowedCommand) === normalizeCommand(command),
  );
}

function createDecisionMessage(
  allowed: boolean,
  requiresApproval: boolean,
  reasons: string[],
  violations: string[],
): string {
  if (allowed) {
    return 'Policy Gate approved this run.';
  }

  if (requiresApproval) {
    return reasons.length > 0
      ? `Policy Gate requires human approval before execution: ${reasons.join('; ')}.`
      : 'Policy Gate requires human approval before execution.';
  }

  const parts: string[] = ['Policy Gate blocked this run.'];
  if (violations.length > 0) {
    parts.push(`Violations: ${violations.join('; ')}.`);
  }
  if (reasons.length > 0) {
    parts.push(`Reasons: ${reasons.join('; ')}.`);
  }
  return parts.join(' ');
}

export function createPolicyGate(policy: PolicyGateConfig): PolicyGate {
  const oversightMode = policy.oversightMode;
  const maxRisk = policy.maxRisk ?? 'high';
  const allowedFiles = policy.allowedFiles?.map(normalizePath) ?? [];
  const allowedCommands = policy.allowedCommands?.map(normalizeCommand) ?? [];
  const blockedCommands = policy.blockedCommands?.map(normalizeCommand) ?? [];
  const requireApprovalFor = policy.requireApprovalFor?.map((value) =>
    value.toLowerCase().trim(),
  ) ?? [];

  return {
    evaluate(request: PolicyGateRequest): PolicyGateDecision {
      const risk = request.risk ?? 'low';
      const requestedFiles = request.requestedFiles ?? [];
      const requestedCommands = request.requestedCommands ?? [];
      const reasons: string[] = [];
      const violations: string[] = [];
      const approvalReasons: string[] = [];

      const riskTooHigh = riskRank(risk) > riskRank(maxRisk);
      if (riskTooHigh) {
        violations.push(`risk ${risk} exceeds maxRisk ${maxRisk}`);
        reasons.push(`request risk ${risk} exceeds policy maxRisk ${maxRisk}`);
      }

      for (const file of requestedFiles) {
        if (allowedFiles.length > 0 && !matchesAnyAllowedFile(allowedFiles, file)) {
          violations.push(`file not allowed: ${normalizePath(file)}`);
        }
      }

      for (const command of requestedCommands) {
        if (
          blockedCommands.some((blockedCommand) =>
            commandMatchesBlockedPattern(blockedCommand, command),
          )
        ) {
          violations.push(`blocked command: ${command.trim()}`);
        }

        if (
          allowedCommands.length > 0 &&
          !commandIsAllowed(allowedCommands, command)
        ) {
          violations.push(`command not allowed: ${command.trim()}`);
        }
      }

      const requestText = [request.task, ...requestedCommands].join(' ').toLowerCase();
      const matchedApprovalRules = requireApprovalFor.filter((trigger) =>
        trigger && requestText.includes(trigger),
      );

      if (matchedApprovalRules.length > 0 && !request.hasHumanApproval) {
        approvalReasons.push(
          `requires approval for: ${matchedApprovalRules.join(', ')}`,
        );
      }

      if (oversightMode === 'HITL' && risk === 'high' && !request.hasHumanApproval) {
        approvalReasons.push('high-risk run requires human approval in HITL mode');
      }

      if (approvalReasons.length > 0) {
        reasons.push(...approvalReasons);
      }

      const blocked = violations.length > 0;
      const requiresApproval = !blocked && approvalReasons.length > 0;
      const allowed = !blocked && !requiresApproval;
      const message = createDecisionMessage(allowed, requiresApproval, reasons, violations);

      return {
        allowed,
        requiresApproval,
        reasons,
        violations,
        oversightMode,
        risk,
        message,
      };
    },
  };
}

function formatMaybeList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

function formatMaybeText(value?: string): string {
  return value && value.trim() ? value : 'None';
}

function cloneScopeCheckAllowed(
  allowed?: string[] | boolean,
): string[] | boolean | undefined {
  if (Array.isArray(allowed)) {
    return [...allowed];
  }

  if (typeof allowed === 'boolean') {
    return allowed;
  }

  return undefined;
}

function cloneMaybeStringArray(values?: string[]): string[] | undefined {
  return Array.isArray(values) ? [...values] : undefined;
}

function formatMaybeScopeAllowed(value?: string[] | boolean): string {
  if (Array.isArray(value)) {
    return formatMaybeList(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return 'None';
}

function formatMaybeNumber(value?: number): string {
  return typeof value === 'number' ? String(value) : 'n/a';
}

export function createAgentRunLedger(
  initialMetadata: AgentRunLedgerMetadata,
): AgentRunLedger {
  const metadata = cloneAgentRunLedgerMetadata({
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    task: 'untitled',
    startedAt: new Date().toISOString(),
    allowedFiles: [],
    ...initialMetadata,
  });
  const events: AgentRunLedgerEvent[] = [];
  const prompts: string[] = [];
  const commands: AgentRunLedgerCommand[] = [];
  const changedFiles: string[][] = [];
  const validations: AgentRunLedgerValidation[] = [];
  const scopeChecks: AgentRunLedgerScopeCheck[] = [];
  const approvals: AgentRunLedgerApproval[] = [];
  let status: AgentRunLedgerCloseStatus | 'open' = 'open';
  let closedAt: string | null = null;

  function addEvent(event: AgentRunLedgerEvent): void {
    events.push(event);
  }

  function now(): string {
    return new Date().toISOString();
  }

  function cloneLedgerEvent(entry: AgentRunLedgerEvent): AgentRunLedgerEvent {
    switch (entry.type) {
      case 'prompt':
        return {
          timestamp: entry.timestamp,
          type: 'prompt',
          data: { prompt: entry.data.prompt },
        };
      case 'command':
        return {
          timestamp: entry.timestamp,
          type: 'command',
          data: {
            command: entry.data.command,
            result: entry.data.result ? { ...entry.data.result } : undefined,
          },
        };
      case 'changed_files':
        return {
          timestamp: entry.timestamp,
          type: 'changed_files',
          data: { files: [...entry.data.files] },
        };
      case 'validation':
        return {
          timestamp: entry.timestamp,
          type: 'validation',
          data: { ...entry.data },
        };
      case 'scope_check':
        return {
          timestamp: entry.timestamp,
          type: 'scope_check',
          data: {
            ok: entry.data.ok,
            allowed: cloneScopeCheckAllowed(entry.data.allowed),
            requiresApproval: entry.data.requiresApproval,
            reasons: cloneMaybeStringArray(entry.data.reasons),
            violations: cloneMaybeStringArray(entry.data.violations),
            message: entry.data.message,
            oversightMode: entry.data.oversightMode,
            risk: entry.data.risk,
          },
        };
      case 'approval':
        return {
          timestamp: entry.timestamp,
          type: 'approval',
          data: { ...entry.data },
        };
      case 'close':
        return {
          timestamp: entry.timestamp,
          type: 'close',
          data: { status: entry.data.status },
        };
    }
  }

  function cloneJSON(): AgentRunLedgerJSON {
    return {
      metadata: cloneAgentRunLedgerMetadata(metadata),
      status,
      closedAt,
      prompts: [...prompts],
      commands: commands.map((entry) => ({
        command: entry.command,
        result: entry.result ? { ...entry.result } : undefined,
      })),
      changedFiles: changedFiles.map((entry) => [...entry]),
      validations: validations.map((entry) => ({ ...entry })),
      scopeChecks: scopeChecks.map((entry) => ({
        ok: entry.ok,
        allowed: cloneScopeCheckAllowed(entry.allowed),
        requiresApproval: entry.requiresApproval,
        reasons: cloneMaybeStringArray(entry.reasons),
        violations: cloneMaybeStringArray(entry.violations),
        message: entry.message,
        oversightMode: entry.oversightMode,
        risk: entry.risk,
      })),
      approvals: approvals.map((entry) => ({ ...entry })),
      events: events.map(cloneLedgerEvent),
    };
  }

  function recordPrompt(prompt: string): void {
    prompts.push(prompt);
    addEvent({ timestamp: Date.now(), type: 'prompt', data: { prompt } });
  }

  function recordCommand(
    command: string,
    result?: AgentRunLedgerCommandResult,
  ): void {
    const entry = { command, result: result ? { ...result } : undefined };
    commands.push(entry);
    addEvent({
      timestamp: Date.now(),
      type: 'command',
      data: {
        command,
        result: entry.result ? { ...entry.result } : undefined,
      },
    });
  }

  function recordChangedFiles(files: string[]): void {
    const entry = [...files];
    changedFiles.push(entry);
    addEvent({
      timestamp: Date.now(),
      type: 'changed_files',
      data: { files: [...entry] },
    });
  }

  function recordValidation(
    name: string,
    validationStatus: AgentRunLedgerValidationStatus,
    details?: string,
  ): void {
    const entry: AgentRunLedgerValidation = {
      name,
      status: validationStatus,
      details,
    };
    validations.push(entry);
    addEvent({ timestamp: Date.now(), type: 'validation', data: { ...entry } });
  }

  function recordScopeCheck(result: AgentRunLedgerScopeCheckInput): void {
    const entry: AgentRunLedgerScopeCheck = {
      ok:
        typeof result.ok === 'boolean'
          ? result.ok
          : typeof result.allowed === 'boolean'
            ? result.allowed
            : !(Array.isArray(result.violations) && result.violations.length > 0),
      allowed: cloneScopeCheckAllowed(result.allowed),
      requiresApproval: result.requiresApproval,
      reasons: cloneMaybeStringArray(result.reasons),
      violations: cloneMaybeStringArray(result.violations),
      message: result.message,
      oversightMode: result.oversightMode,
      risk: result.risk,
    };
    scopeChecks.push(entry);
    addEvent({ timestamp: Date.now(), type: 'scope_check', data: { ...entry } });
  }

  function recordApproval(
    approver: string,
    decision: AgentRunLedgerApprovalDecision,
    note?: string,
  ): void {
    const entry: AgentRunLedgerApproval = { approver, decision, note };
    approvals.push(entry);
    addEvent({ timestamp: Date.now(), type: 'approval', data: { ...entry } });
  }

  function close(nextStatus: AgentRunLedgerCloseStatus): void {
    status = nextStatus;
    closedAt = now();
    addEvent({
      timestamp: Date.now(),
      type: 'close',
      data: { status: nextStatus },
    });
  }

  function toMarkdown(): string {
    const json = cloneJSON();
    const lines: string[] = ['# Agent Run Ledger', ''];

    lines.push(`Run ID: ${json.metadata.runId}`);
    lines.push(`Agent: ${json.metadata.agent}`);
    lines.push(`Executor: ${json.metadata.executor}`);
    lines.push(`Repo: ${json.metadata.repo}`);
    lines.push(`Task: ${json.metadata.task}`);
    lines.push(`Status: ${json.status}`);
    lines.push(`Started at: ${json.metadata.startedAt}`);
    lines.push(`Closed at: ${json.closedAt ?? 'open'}`);

    lines.push('', '## Allowed Files', '', formatMaybeList(json.metadata.allowedFiles ?? []));
    lines.push('', '## Prompt History', '');
    lines.push(
      json.prompts.length > 0 ? json.prompts.map((prompt) => `- ${prompt}`).join('\n') : 'None',
    );

    lines.push('', '## Commands', '');
    if (json.commands.length === 0) {
      lines.push('None');
    } else {
      json.commands.forEach((entry, index) => {
        lines.push(`${index + 1}. ${entry.command}`);
        lines.push(`   - exit code: ${formatMaybeNumber(entry.result?.exitCode)}`);
        lines.push(`   - summary: ${formatMaybeText(entry.result?.summary)}`);
      });
    }

    lines.push('', '## Changed Files', '');
    if (json.changedFiles.length === 0) {
      lines.push('None');
    } else {
      json.changedFiles.forEach((group, index) => {
        lines.push(`${index + 1}.`);
        lines.push(formatMaybeList(group));
      });
    }

    lines.push('', '## Validations', '');
    lines.push(
      json.validations.length > 0
        ? json.validations
            .map(
              (entry) =>
                `- ${entry.name}: ${entry.status}${entry.details ? ` — ${entry.details}` : ''}`,
            )
            .join('\n')
        : 'None',
    );

    lines.push('', '## Scope Checks', '');
    if (json.scopeChecks.length === 0) {
      lines.push('None');
    } else {
      json.scopeChecks.forEach((entry) => {
        lines.push(`- ok: ${entry.ok ? 'yes' : 'no'}`);
        lines.push(`  - allowed: ${formatMaybeScopeAllowed(entry.allowed)}`);
        lines.push(`  - reasons: ${formatMaybeList(entry.reasons ?? [])}`);
        lines.push(`  - violations: ${formatMaybeList(entry.violations ?? [])}`);
        lines.push(`  - message: ${formatMaybeText(entry.message)}`);
        if (typeof entry.requiresApproval === 'boolean') {
          lines.push(`  - requires approval: ${entry.requiresApproval ? 'yes' : 'no'}`);
        }
        if (entry.oversightMode) {
          lines.push(`  - oversight mode: ${entry.oversightMode}`);
        }
        if (entry.risk) {
          lines.push(`  - risk: ${entry.risk}`);
        }
      });
    }

    lines.push('', '## Human Approval', '');
    lines.push(
      json.approvals.length > 0
        ? json.approvals
            .map(
              (entry) =>
                `- ${entry.approver}: ${entry.decision}${entry.note ? ` — ${entry.note}` : ''}`,
            )
            .join('\n')
        : 'None',
    );

    lines.push('', '## Events', '');
    lines.push(
      json.events.length > 0
        ? json.events
            .map((entry) => {
              const when = new Date(entry.timestamp).toISOString();
              switch (entry.type) {
                case 'prompt':
                  return `- [${when}] prompt: ${entry.data.prompt}`;
                case 'command':
                  return `- [${when}] command: ${entry.data.command}`;
                case 'changed_files':
                  return `- [${when}] changed files: ${entry.data.files.join(', ')}`;
                case 'validation':
                  return `- [${when}] validation: ${entry.data.name} (${entry.data.status})`;
                case 'scope_check':
                  return `- [${when}] scope check: ${entry.data.ok ? 'ok' : 'violations'}`;
                case 'approval':
                  return `- [${when}] approval: ${entry.data.approver} (${entry.data.decision})`;
                case 'close':
                  return `- [${when}] close: ${entry.data.status}`;
              }
            })
            .join('\n')
        : 'None',
    );

    return lines.join('\n').trim();
  }

  return {
    recordPrompt,
    recordCommand,
    recordChangedFiles,
    recordValidation,
    recordScopeCheck,
    recordApproval,
    close,
    toJSON: cloneJSON,
    toMarkdown,
  };
}

function formatAuditSummary(auditEntries: AuditEntry[]): string | null {
  if (auditEntries.length === 0) return null;

  const counts = new Map<AuditEntry['type'], number>();
  for (const entry of auditEntries) {
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }

  const lines = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `* ${type}${count > 1 ? ` x${count}` : ''}`);

  return lines.join('\n');
}

function extractRecommendedAction(escalationMessage: string): string | null {
  const match = escalationMessage.match(
    /What a human should decide next:\s*([\s\S]*)$/,
  );
  if (!match) return null;

  return match[1].trim().replace(/\n+/g, ' ');
}

export function toMarkdownReport(result: BreakerResult): string {
  const status = result.success ? 'Succeeded' : 'Failed';
  const lines: string[] = ['# Safeloop Report', ''];

  lines.push(`Status: ${status}`);

  if (!result.success && result.stoppedBy) {
    lines.push(`Trip reason: ${result.stoppedBy}`);
  }

  lines.push(`Attempts: ${result.attempts}`);

  if (typeof result.tokenEstimate === 'number') {
    lines.push(`Token usage: ${result.tokenEstimate}`);
  }

  if (result.lastError) {
    lines.push(`Last error: ${result.lastError}`);
  }

  if (result.escalationMessage) {
    lines.push('', '## Escalation', '', result.escalationMessage);

    const recommendedAction = extractRecommendedAction(result.escalationMessage);
    if (recommendedAction) {
      lines.push('', `Recommended human action: ${recommendedAction}`);
    }
  }

  const auditSummary = formatAuditSummary(result.auditEntries ?? []);
  if (auditSummary) {
    lines.push('', '## Audit Summary', '', auditSummary);
  }

  return lines.join('\n').trim();
}

export {
  createCaseFile,
  addCaseContext,
  recordCaseDecision,
  recordCaseRisk,
  requestCaseApproval,
  resolveCaseApproval,
  recordHandoff,
  attachArtifact,
  removeAttachment,
  listAttachments,
  addParticipant,
  removeParticipant,
  listParticipants,
  getParticipant,
  hasParticipant,
} from './caseFile';
export { exportCaseReportMarkdown, exportCaseReportJSON } from './caseReport';
export {
  generateHandoffManifest,
  exportHandoffManifestMarkdown,
  exportHandoffManifestJSON,
} from './handoffManifest';
export {
  querySafeloop,
  createProjectGuardrailReport,
  exportSafeloopQueryMarkdown,
  exportSafeloopQueryJSON,
} from './safeloopQuery';
export {
  createAgentSession,
  processAgentEvent,
  exportAgentSessionMarkdown,
  exportAgentSessionJSON,
} from './agentAdapter';
export { appendEvent, readEvents, streamEvents } from './eventStream';
export { recordModelUsage, recordTokenCost, readModelUsage, readTokenCosts } from './modelUsage';
export {
  setModelPricing,
  calculateCost,
  getCaseCostSummary,
  readModelPricing,
} from './costTracker';
export {
  recordSteeringProfile,
  compareSteeringRuns,
  readSteeringProfiles,
} from './steeringTracker';
export { detectGoalDrift } from './driftDetection';
export { calculateReadinessScore } from './readinessScore';
export {
  getDashboardSnapshot,
  createMonitorServer,
  startMonitorServer,
  renderMonitorHtml,
  buildMonitorDashboardPayload,
  buildMonitorViewModel,
  summarizeLoopSummaries,
} from './monitor';
export type {
  MonitorServerOptions,
  MonitorDashboardPayload,
  MonitorViewModel,
  TimecardCollection,
  LoopTimecard,
} from './monitor';
export type {
  CaseFile,
  CaseFileCreateInput,
  CaseFileStatus,
  CaseContextEntry,
  CaseContextInput,
  CaseDecisionEntry,
  CaseDecisionInput,
  CaseRiskEntry,
  CaseRiskInput,
  CaseRiskSeverity,
  CaseApprovalRecord,
  CaseApprovalRequestInput,
  CaseApprovalResolutionInput,
  CaseApprovalStatus,
  CaseHandoffRecord,
  CaseHandoffInput,
  CaseAttachment,
  CaseAttachmentInput,
  CaseAttachmentType,
  CaseReportJSON,
  CaseReportMarkdownOptions,
  CaseReportSummary,
  Participant,
  ParticipantInput,
  ParticipantType,
  ParticipantRole,
  HandoffManifest,
  HandoffManifestSourceCase,
} from './caseTypes';
export type {
  SafeloopReportQuery,
  SafeloopQueryResult,
  SafeloopReportQueryType,
  ProjectGuardrailReportInput,
  SafeloopCaseLike,
} from './safeloopQuery';
export type {
  AgentAdapter,
  AgentAdapterEvent,
  AgentAdapterEventType,
  AgentCapability,
  AgentCapabilities,
  AgentType,
  AgentSession,
  AgentSessionJSON,
  AgentSessionSummary,
  AgentGeneratedReport,
} from './agentAdapter';
export type {
  SafeloopStreamEvent,
  SafeloopStreamEventType,
  SafeloopStreamEventInput,
} from './eventStream';
export type {
  ModelUsageRecord,
  ModelUsageInput,
  TokenCostRecord,
  TokenCostInput,
  ModelArchitecture,
} from './modelUsage';
export type {
  ModelPricingDefinition,
  CostCalculationResult,
  CaseCostSummary,
} from './costTracker';
export type {
  SteeringProfileInput,
  SteeringProfileRecord,
  SteeringComparison,
} from './steeringTracker';
export type {
  GoalDriftInput,
  GoalDriftResult,
  GoalDriftStatus,
} from './driftDetection';
export type {
  ReadinessScoreInput,
  ReadinessScoreResult,
  ReadinessRiskInput,
} from './readinessScore';

function extractTokenCost(value: unknown): number {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stepCost = typeof obj._stepTokenCost === 'number' ? obj._stepTokenCost : 0;
    const totalEstimate = typeof obj._tokenEstimate === 'number' ? obj._tokenEstimate : 0;
    const tokensUsed = typeof obj.tokensUsed === 'number' ? obj.tokensUsed : 0;
    return stepCost || totalEstimate || tokensUsed;
  }
  return 0;
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.split('\n')[0].trim();
  }
  return String(err).split('\n')[0].trim();
}

export function createBreaker(config?: BreakerConfig): Breaker {
  const maxRetries = config?.maxRetries ?? DEFAULTS.maxRetries;
  const maxRepeatedErrors =
    config?.maxRepeatedErrors ?? DEFAULTS.maxRepeatedErrors;
  const perStepBudget =
    config?.tokenBudget?.perStep ?? DEFAULTS.tokenBudget.perStep;
  const perTaskBudget =
    config?.tokenBudget?.perTask ?? DEFAULTS.tokenBudget.perTask;
  const scopeFreeze = config?.scopeFreeze ?? DEFAULTS.scopeFreeze;

  let killSwitchEngaged = false;
  let killReason = '';
  let attempts = 0;
  let tokenUsed = 0;
  let lastError: string | null = null;
  let escalationMessage: string | null = null;
  let normalizedErrors: string[] = [];
  let stoppedBy: string = '';
  let isTripped = false;
  let tripReason: string | null = null;
  const auditEntries: AuditEntry[] = [];
  let abortController: AbortController | null = null;
  let scopeProposed = false;
  let scopeProposalDescription = '';

  function record(
    type: AuditEntry['type'],
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    auditEntries.push({ timestamp: Date.now(), type, message, metadata });
  }

  function detectRepeatedError(errorMessage: string): boolean {
    if (maxRepeatedErrors === 0) return false;
    let consecutiveCount = 0;
    for (let i = normalizedErrors.length - 1; i >= 0; i--) {
      if (normalizedErrors[i] === errorMessage) {
        consecutiveCount++;
      } else {
        break;
      }
    }
    return consecutiveCount >= maxRepeatedErrors;
  }

  function checkScopeInResult(taskResult: unknown): boolean {
    if (!scopeFreeze) return false;
    if (taskResult && typeof taskResult === 'object') {
      const obj = taskResult as Record<string, unknown>;
      const newGoals =
        obj._newGoals || obj.newGoals || obj._newTasks || obj.newTasks;
      if (Array.isArray(newGoals) && newGoals.length > 0) {
        return true;
      }
    }
    return false;
  }

  function buildEscalation(context: string, detail: string): string {
    return [
      `The agent loop was stopped.`,
      ``,
      `What failed: ${context}`,
      `What was tried: ${attempts} attempt(s) were made.`,
      `Why it stopped: ${detail}`,
      `What a human should decide next: Review the task and error above. ` +
        `You may retry with a different approach, adjust configuration ` +
        `(maxRetries, tokenBudget, maxRepeatedErrors), or abandon the task.`,
    ].join('\n');
  }

  async function run<T>(
    taskFn: (ctx: BreakerContext) => Promise<T>,
  ): Promise<BreakerResult> {
    killSwitchEngaged = false;
    killReason = '';
    attempts = 0;
    tokenUsed = 0;
    lastError = null;
    escalationMessage = null;
    normalizedErrors = [];
    stoppedBy = '';
    isTripped = false;
    tripReason = null;
    auditEntries.length = 0;
    abortController = new AbortController();
    scopeProposed = false;
    scopeProposalDescription = '';

    while (true) {
      if (killSwitchEngaged || abortController?.signal.aborted) {
        const reason = killReason || 'kill switch engaged';
        isTripped = true;
        record('breaker_trip', `Kill switch engaged: ${reason}`);
        return {
          success: false,
          stoppedBy: 'kill_switch',
          attempts,
          tokenEstimate: tokenUsed,
          lastError,
          escalationMessage: buildEscalation(
            `Task was manually stopped.`,
            `The kill switch was engaged: ${reason}`,
          ),
          auditEntries: [...auditEntries],
        };
      }

      if (attempts > maxRetries) {
        isTripped = true;
        record('breaker_trip', `Exceeded max retries (${maxRetries})`);
        escalationMessage = buildEscalation(
          `The task failed on every attempt. Last error: ${lastError ?? 'unknown'}`,
          `The maximum number of retries (${maxRetries}) was exceeded after ${attempts} attempt(s).`,
        );
        return {
          success: false,
          stoppedBy: 'max_retries',
          attempts,
          tokenEstimate: tokenUsed,
          lastError,
          escalationMessage,
          auditEntries: [...auditEntries],
        };
      }

      attempts++;
      record('attempt', `Attempt ${attempts}`, {
        attempt: attempts,
        tokenUsed,
      });

      const context: BreakerContext = {
        attempt: attempts,
        tokenUsed,
        signal: abortController!.signal,
        log: (entry) => {
          record(entry.type, entry.message, entry.metadata);
        },
        recordTokenUsage: (cost: number) => {
          tokenUsed += cost;
          record('token_usage', `Recorded ${cost} tokens`, { cost });
        },
        proposeScopeChange: (description: string, newGoals: string[]) => {
          if (!scopeFreeze) return true;
          scopeProposed = true;
          scopeProposalDescription = `${description}: ${newGoals.join(', ')}`;
          record(
            'scope_proposed',
            `Scope change requested: ${scopeProposalDescription}`,
            { description, newGoals },
          );
          record(
            'scope_denied',
            `Scope change denied: ${scopeProposalDescription}`,
          );
          return false;
        },
      };

      try {
        const result = await taskFn(context);

        if (killSwitchEngaged) {
          record('breaker_trip', `Kill switch engaged: ${killReason}`);
          return {
            success: false,
            stoppedBy: 'kill_switch',
            attempts,
            tokenEstimate: tokenUsed,
            lastError,
            escalationMessage: buildEscalation(
              `Task was manually stopped.`,
              `The kill switch was engaged: ${killReason}`,
            ),
            auditEntries: [...auditEntries],
          };
        }

        const tokenCost = extractTokenCost(result);
        tokenUsed += tokenCost;

        if (scopeProposed) {
          isTripped = true;
          record(
            'breaker_trip',
            `Scope change denied: ${scopeProposalDescription}`,
          );
          escalationMessage = buildEscalation(
            `The agent attempted to expand scope: ${scopeProposalDescription}`,
            `Scope freeze is enabled. The agent requested to add new goals ` +
              `without explicit human approval.`,
          );
          return {
            success: false,
            stoppedBy: 'scope_freeze',
            attempts,
            tokenEstimate: tokenUsed,
            lastError: null,
            escalationMessage,
            auditEntries: [...auditEntries],
          };
        }

        if (tokenUsed > perTaskBudget) {
          isTripped = true;
          record(
            'budget_check',
            `Task token budget exceeded: ${tokenUsed} > ${perTaskBudget}`,
          );
          escalationMessage = buildEscalation(
            `The task consumed ${tokenUsed} tokens (budget: ${perTaskBudget}).`,
            `The task-level token budget was exceeded.`,
          );
          return {
            success: false,
            stoppedBy: 'token_budget_task',
            attempts,
            tokenEstimate: tokenUsed,
            lastError: null,
            escalationMessage,
            auditEntries: [...auditEntries],
          };
        }

        if (tokenCost > perStepBudget) {
          isTripped = true;
          record(
            'budget_check',
            `Step token budget exceeded: ${tokenCost} > ${perStepBudget}`,
          );
          escalationMessage = buildEscalation(
            `A single step consumed ${tokenCost} tokens (per-step budget: ${perStepBudget}).`,
            `The per-step token budget was exceeded.`,
          );
          return {
            success: false,
            stoppedBy: 'token_budget_step',
            attempts,
            tokenEstimate: tokenUsed,
            lastError: null,
            escalationMessage,
            auditEntries: [...auditEntries],
          };
        }

        if (checkScopeInResult(result)) {
          isTripped = true;
          record(
            'scope_denied',
            'Task returned new goals without using proposeScopeChange()',
          );
          escalationMessage = buildEscalation(
            `The agent returned new goals or tasks in its result without ` +
              `explicitly requesting approval via proposeScopeChange().`,
            `Scope freeze is enabled. The task may not silently add new goals.`,
          );
          return {
            success: false,
            stoppedBy: 'scope_freeze',
            attempts,
            tokenEstimate: tokenUsed,
            lastError: null,
            escalationMessage,
            auditEntries: [...auditEntries],
          };
        }

        record('retry', `Attempt ${attempts} succeeded`);
        return {
          success: true,
          stoppedBy: '',
          attempts,
          tokenEstimate: tokenUsed,
          lastError: null,
          escalationMessage: null,
          auditEntries: [...auditEntries],
          data: result,
        };
      } catch (err) {
        const errMsg = normalizeError(err);
        const errTokenCost = extractTokenCost(err);
        tokenUsed += errTokenCost;
        lastError = errMsg;
        normalizedErrors.push(errMsg);
        record('failure', `Attempt ${attempts} failed: ${errMsg}`, errTokenCost ? { tokenCost: errTokenCost } : undefined);

        if (detectRepeatedError(errMsg)) {
          isTripped = true;
          record(
            'breaker_trip',
            `Repeated error detected: "${errMsg}" appeared ` +
              `${normalizedErrors.filter((e) => e === errMsg).length} times`,
          );
          escalationMessage = buildEscalation(
            `The task failed with: "${errMsg}".`,
            `The same error repeated ${normalizedErrors.filter((e) => e === errMsg).length} times ` +
              `(threshold: ${maxRepeatedErrors}). The agent appears to be stuck.`,
          );
          return {
            success: false,
            stoppedBy: 'repeated_error',
            attempts,
            tokenEstimate: tokenUsed,
            lastError: errMsg,
            escalationMessage,
            auditEntries: [...auditEntries],
          };
        }

        record('retry', `Retrying after attempt ${attempts}`);
      }
    }
  }

  return {
    run,

    trip(reason: string) {
      killSwitchEngaged = true;
      killReason = reason;
      isTripped = true;
      tripReason = reason;
      record('kill_switch', `Manual kill switch: ${reason}`);
      if (abortController) {
        abortController.abort(reason);
      }
    },

    reset() {
      killSwitchEngaged = false;
      killReason = '';
      attempts = 0;
      tokenUsed = 0;
      lastError = null;
      escalationMessage = null;
      normalizedErrors = [];
      stoppedBy = '';
      isTripped = false;
      tripReason = null;
      auditEntries.length = 0;
      abortController = null;
      scopeProposed = false;
      scopeProposalDescription = '';
    },

    status(): BreakerStatus {
      return {
        isTripped,
        isKilled: killSwitchEngaged,
        attempts,
        tripReason,
      };
    },

    log(): AuditEntry[] {
      return [...auditEntries];
    },
  };
}
