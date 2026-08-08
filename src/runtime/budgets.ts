/**
 * Runtime budgets.
 *
 * v0.1 expressed budgets as scenario-contract fields that fed risk scoring. A
 * risk score is advisory; a budget is supposed to stop things. This module
 * makes budgets an admission control checked at the executor call site, so an
 * exhausted hard budget blocks a real side effect rather than raising a score.
 */

export interface BudgetLimits {
  maximum_actions?: number;
  maximum_runtime_ms?: number;
  maximum_tokens?: number;
  maximum_cost_usd?: number;
  maximum_retries?: number;
}

export interface BudgetUsage {
  actions: number;
  runtime_ms: number;
  tokens: number;
  cost_usd: number;
  retries: number;
}

export type BudgetCategory = 'actions' | 'runtime' | 'tokens' | 'cost' | 'retries';

export interface BudgetVerdict {
  permitted: boolean;
  exhausted?: BudgetCategory;
  reason?: string;
  usage: BudgetUsage;
  limits: BudgetLimits;
}

export interface BudgetTracker {
  /** Admission check. Called before every managed execution. */
  check(): BudgetVerdict;
  recordAction(): void;
  recordTokens(count: number): void;
  recordCost(usd: number): void;
  recordRetry(): void;
  usage(): BudgetUsage;
  limits(): BudgetLimits;
  remaining(): Record<BudgetCategory, number | null>;
  reset(): void;
}

export function createBudgetTracker(limits: BudgetLimits = {}, startedAt: number = Date.now()): BudgetTracker {
  let actions = 0;
  let tokens = 0;
  let costUsd = 0;
  let retries = 0;
  let started = startedAt;

  function currentUsage(): BudgetUsage {
    return {
      actions,
      runtime_ms: Date.now() - started,
      tokens,
      cost_usd: costUsd,
      retries,
    };
  }

  function exceeded(limit: number | undefined, used: number): boolean {
    return typeof limit === 'number' && used >= limit;
  }

  return {
    check(): BudgetVerdict {
      const usage = currentUsage();

      // Ordered so the most operator-legible exhaustion is reported first.
      const checks: Array<[BudgetCategory, boolean, string]> = [
        ['actions', exceeded(limits.maximum_actions, usage.actions),
          `action budget exhausted (${usage.actions}/${limits.maximum_actions})`],
        ['runtime', exceeded(limits.maximum_runtime_ms, usage.runtime_ms),
          `runtime budget exhausted (${usage.runtime_ms}ms/${limits.maximum_runtime_ms}ms)`],
        ['tokens', exceeded(limits.maximum_tokens, usage.tokens),
          `token budget exhausted (${usage.tokens}/${limits.maximum_tokens})`],
        ['cost', exceeded(limits.maximum_cost_usd, usage.cost_usd),
          `cost budget exhausted (${usage.cost_usd}/${limits.maximum_cost_usd} USD)`],
        ['retries', exceeded(limits.maximum_retries, usage.retries),
          `retry budget exhausted (${usage.retries}/${limits.maximum_retries})`],
      ];

      for (const [category, isExceeded, reason] of checks) {
        if (isExceeded) {
          return { permitted: false, exhausted: category, reason, usage, limits };
        }
      }
      return { permitted: true, usage, limits };
    },

    recordAction(): void { actions += 1; },
    recordTokens(count: number): void { tokens += Math.max(0, count); },
    recordCost(usd: number): void { costUsd += Math.max(0, usd); },
    recordRetry(): void { retries += 1; },
    usage: currentUsage,
    limits: () => ({ ...limits }),

    remaining(): Record<BudgetCategory, number | null> {
      const usage = currentUsage();
      return {
        actions: typeof limits.maximum_actions === 'number' ? Math.max(0, limits.maximum_actions - usage.actions) : null,
        runtime: typeof limits.maximum_runtime_ms === 'number' ? Math.max(0, limits.maximum_runtime_ms - usage.runtime_ms) : null,
        tokens: typeof limits.maximum_tokens === 'number' ? Math.max(0, limits.maximum_tokens - usage.tokens) : null,
        cost: typeof limits.maximum_cost_usd === 'number' ? Math.max(0, limits.maximum_cost_usd - usage.cost_usd) : null,
        retries: typeof limits.maximum_retries === 'number' ? Math.max(0, limits.maximum_retries - usage.retries) : null,
      };
    },

    reset(): void {
      actions = 0;
      tokens = 0;
      costUsd = 0;
      retries = 0;
      started = Date.now();
    },
  };
}
