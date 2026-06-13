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
} as const;

function extractTokenCost(value: unknown): number {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stepCost = typeof obj._stepTokenCost === 'number' ? obj._stepTokenCost : 0;
    const totalEstimate = typeof obj._tokenEstimate === 'number' ? obj._tokenEstimate : 0;
    return stepCost || totalEstimate;
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
        isTripped: killSwitchEngaged,
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
