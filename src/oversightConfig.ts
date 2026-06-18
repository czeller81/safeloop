export interface OversightPenalties {
  costPenalty: number;
  tokenPenalty: number;
  durationPenalty: number;
  stalePenalty: number;
  repeatedFailuresPenalty: number;
  providerRetryPenalty: number;
  patchNoopPenalty: number;
  unresolvedApprovalPenalty: number;
  highRiskPenalty: number;
  artifactWithoutCompletionPenalty: number;
  completionWithoutReportPenalty: number;
  missingAttributionPenalty: number;
  modelUsageWithoutCostPenalty: number;
  historicalActivesPenalty: number;
  explainabilityMissingPenalty: number;
  decisionMissingExplanationPenalty: number;
  feedbackNeedsReviewPenalty: number;
}

export interface OversightConfig {
  staleLoopMs: number;
  maxLoopCost: number;
  maxLoopTokens: number;
  maxLoopDurationMs: number;
  maxHistoricalRunningLoops: number;
  penalties: OversightPenalties;
}

export const defaultOversightConfig: OversightConfig = {
  // 2 hours stale window (matches view-model LOOP_STALE_MS)
  staleLoopMs: 2 * 60 * 60 * 1000,
  // default budget / cost thresholds
  maxLoopCost: 0.02,
  // token threshold
  maxLoopTokens: 50000,
  // loop duration threshold (90 minutes)
  maxLoopDurationMs: 90 * 60 * 1000,
  // how many historical active loops before anomaly
  maxHistoricalRunningLoops: 2,
  penalties: {
    costPenalty: 15,
    tokenPenalty: 12,
    durationPenalty: 10,
    stalePenalty: 10,
    repeatedFailuresPenalty: 15,
    providerRetryPenalty: 10,
    patchNoopPenalty: 10,
    unresolvedApprovalPenalty: 15,
    highRiskPenalty: 15,
    artifactWithoutCompletionPenalty: 10,
    completionWithoutReportPenalty: 10,
    missingAttributionPenalty: 20,
    modelUsageWithoutCostPenalty: 10,
    historicalActivesPenalty: 15,
    explainabilityMissingPenalty: 10,
    decisionMissingExplanationPenalty: 5,
    feedbackNeedsReviewPenalty: 5,
  },
};

export function mergeOversightConfig(overrides: Partial<OversightConfig> | undefined): OversightConfig {
  if (!overrides) return defaultOversightConfig;
  return {
    staleLoopMs: overrides.staleLoopMs ?? defaultOversightConfig.staleLoopMs,
    maxLoopCost: overrides.maxLoopCost ?? defaultOversightConfig.maxLoopCost,
    maxLoopTokens: overrides.maxLoopTokens ?? defaultOversightConfig.maxLoopTokens,
    maxLoopDurationMs: overrides.maxLoopDurationMs ?? defaultOversightConfig.maxLoopDurationMs,
    maxHistoricalRunningLoops:
      overrides.maxHistoricalRunningLoops ?? defaultOversightConfig.maxHistoricalRunningLoops,
    penalties: {
      ...defaultOversightConfig.penalties,
      ...(overrides.penalties || {}),
    },
  };
}
