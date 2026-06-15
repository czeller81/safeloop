import { type SafeloopStreamEvent } from './eventStream';
import { defaultOversightConfig, mergeOversightConfig, type OversightConfig } from './oversightConfig';

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function flattenSectionEvents(loops: ReadonlyArray<{ _events?: SafeloopStreamEvent[] }>): SafeloopStreamEvent[] {
  const events: SafeloopStreamEvent[] = [];
  for (const loop of loops) {
    if (Array.isArray(loop._events)) events.push(...loop._events);
  }
  return events;
}

export interface OversightIssue {
  code: string;
  severity: 'warning' | 'anomaly';
  message: string;
}

export interface LoopExplainabilitySummary {
  decisionCount: number;
  explainedDecisionCount: number;
  explanationCoveragePercent: number;
  missingExplanationCount: number;
}

export interface LoopFeedbackItem {
  feedbackId?: string;
  targetType: 'loop' | 'event' | 'artifact' | 'decision' | 'approval' | 'handoff';
  targetEventId?: string;
  rating: 'positive' | 'neutral' | 'negative';
  score?: number;
  labels: string[];
  comment: string;
  reviewer?: string;
  timestamp: string;
}

export interface LoopFeedbackSummary {
  feedbackCount: number;
  averageScore: number | null;
  positiveCount: number;
  negativeCount: number;
  latestFeedback: LoopFeedbackItem | null;
  needsReviewFromFeedback: boolean;
}

export function collectLoopFeedback(loops: ReadonlyArray<{ _events?: SafeloopStreamEvent[] }>): LoopFeedbackSummary {
  const feedbackEvents = flattenSectionEvents(loops).filter((e) => e.type === 'feedback.recorded');
  const items = feedbackEvents.map((event) => ({
    feedbackId: asText(event.metadata?.feedbackId) || undefined,
    targetType: (asText(event.metadata?.targetType) as LoopFeedbackItem['targetType']) || 'loop',
    targetEventId: asText(event.metadata?.targetEventId) || undefined,
    rating: (asText(event.metadata?.rating) as LoopFeedbackItem['rating']) || 'neutral',
    score: typeof event.metadata?.score === 'number' ? event.metadata.score : undefined,
    labels: Array.isArray(event.metadata?.labels) ? (event.metadata.labels.filter((l): l is string => typeof l === 'string').map((l) => l.trim()).filter(Boolean)) : [],
    comment: asText(event.metadata?.comment) || event.summary,
    reviewer: asText(event.metadata?.reviewer) || undefined,
    timestamp: asText(event.metadata?.timestamp) || event.timestamp,
  }));
  const positiveCount = items.filter((i) => i.rating === 'positive').length;
  const negativeCount = items.filter((i) => i.rating === 'negative').length;
  const scoredItems = items.filter((i) => typeof i.score === 'number');
  const averageScore = scoredItems.length > 0 ? scoredItems.reduce((s, i) => s + (i.score || 0), 0) / scoredItems.length : null;
  const latestFeedback = items.length > 0 ? [...items].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))[0] : null;
  const needsReviewFromFeedback = negativeCount > 0 && (averageScore === null || averageScore <= 3.5 || negativeCount > positiveCount);
  return { feedbackCount: items.length, averageScore, positiveCount, negativeCount, latestFeedback, needsReviewFromFeedback };
}

export function collectLoopExplainability(loops: ReadonlyArray<{ _events?: SafeloopStreamEvent[] }>): LoopExplainabilitySummary {
  const events = flattenSectionEvents(loops);
  const decisions = events.filter((e) => e.type === 'decision.made');
  const explained = decisions.filter((event) => Boolean(asText(event.metadata?.rationale) || asText(event.metadata?.explanation) || asText(event.metadata?.reason)));
  const highRiskWithoutExplanation = decisions.filter((event) => {
    const severity = asText(event.metadata?.severity) || asText(event.metadata?.risk);
    return (severity === 'high' || severity === 'critical') && !Boolean(asText(event.metadata?.rationale) || asText(event.metadata?.explanation) || asText(event.metadata?.reason));
  });
  const approvalRequestsWithoutReason = events.filter((e) => e.type === 'approval.requested' && !asText(e.metadata?.reason));
  const completedWithoutReport = events.filter((e) => e.type === 'task.completed' && !events.some((c) => c.type === 'report.generated'));
  const missingExplanationCount = (decisions.length - explained.length) + highRiskWithoutExplanation.length + approvalRequestsWithoutReason.length + completedWithoutReport.length;
  return {
    decisionCount: decisions.length,
    explainedDecisionCount: explained.length,
    explanationCoveragePercent: decisions.length === 0 ? 100 : Math.max(0, Math.round((explained.length / decisions.length) * 100)),
    missingExplanationCount: Math.max(0, missingExplanationCount),
  };
}

// Third param: optional oversight config overrides
export function analyzeLoopOversight(loop: any, collection: any, options?: Partial<OversightConfig>) {
  const config = mergeOversightConfig(options);

  const warnings: OversightIssue[] = [];
  const anomalies: OversightIssue[] = [];
  const events: SafeloopStreamEvent[] = Array.isArray(loop._events) ? loop._events : [];
  const usageRecords = Array.isArray(loop._usageRecords) ? loop._usageRecords : [];
  const nowMs = Date.now();
  const lastMs = toTimestamp(loop.lastTimestamp);
  const ageMs = lastMs > 0 ? Math.max(0, nowMs - lastMs) : Number.POSITIVE_INFINITY;

  const staleByAge = loop.status === 'stale' || (loop.status !== 'historical' && ageMs > config.staleLoopMs);
  const durationTooLong = loop.durationMs > config.maxLoopDurationMs;
  const tokenUsage = loop.totalTokens > config.maxLoopTokens;
  const costTooHigh = loop.estimatedCost > config.maxLoopCost;
  const unresolvedApprovals = loop.approvalsStatus === 'pending' || (events.some((e) => e.type === 'approval.requested') && !events.some((e) => e.type === 'approval.resolved'));
  const highRiskWithoutMitigation = events.some((e) => e.type === 'risk.detected' && asText(e.metadata?.severity) === 'high' && !asText(e.metadata?.mitigation));
  const missingAttribution = !loop.project || !loop.taskId || !loop.caseId || !loop.agentId;
  const modelUsageWithoutCost = usageRecords.some((record: any) => !(Number(record.estimatedCost) > 0));
  const repeatedFailures = events.filter((e) => String(e.type).toLowerCase().includes('fail')).length;
  const repeatedProviderRetries = events.filter((e) => String(e.type).toLowerCase().includes('retry') || Number(e.metadata?.retryCount ?? e.metadata?.retries ?? 0) > 1).length;
  const repeatedPatchNoops = events.filter((e) => (String(e.type).toLowerCase().includes('patch') && String(e.type).toLowerCase().includes('noop')) || String(e.summary).toLowerCase().includes('no-op') || String(e.summary).toLowerCase().includes('noop')).length;
  const artifactChangedWithoutCompletion = events.some((e) => e.type === 'artifact.changed') && !events.some((e) => e.type === 'task.completed');
  const taskCompletedWithoutReport = events.some((e) => e.type === 'task.completed') && !events.some((e) => e.type === 'report.generated');
  const historicalActives = Array.isArray(collection.historical) ? collection.historical.filter((item: any) => toTimestamp(item.lastTimestamp) > 0 && item.status !== 'historical' && (nowMs - toTimestamp(item.lastTimestamp)) > 24 * 60 * 60 * 1000).length : 0;

  const explainability = collectLoopExplainability([loop]);
  const feedback = collectLoopFeedback([loop]);

  const decisionMissingExplanation = explainability.missingExplanationCount > 0;
  if (decisionMissingExplanation) warnings.push({ code: 'missing_explanation', severity: 'warning', message: 'Decision explainability is incomplete.' });
  if (explainability.decisionCount > 0 && explainability.explainedDecisionCount === 0) anomalies.push({ code: 'decision_without_rationale', severity: 'anomaly', message: 'Decision.made events do not include rationale or explanation.' });
  if (highRiskWithoutMitigation) anomalies.push({ code: 'high_risk_without_mitigation', severity: 'anomaly', message: 'High-risk work has no mitigation recorded.' });

  // Completed loops should never be marked stale nor be recommended for stale investigation
  const isCompleted = loop.status === 'completed' || events.some((e) => e.type === 'task.completed');
  const staleFlag = !isCompleted && staleByAge;
  if (staleFlag) warnings.push({ code: 'stale_loop', severity: 'warning', message: 'Loop is stale and should be reviewed.' });
  if (durationTooLong) warnings.push({ code: 'duration_threshold_exceeded', severity: 'warning', message: 'Loop duration exceeds the active threshold.' });
  if (tokenUsage) warnings.push({ code: 'token_threshold_exceeded', severity: 'warning', message: 'Token usage exceeds the loop threshold.' });
  if (costTooHigh) warnings.push({ code: 'cost_threshold_exceeded', severity: 'warning', message: 'Cost exceeds the loop threshold.' });
  if (unresolvedApprovals) anomalies.push({ code: 'unresolved_approval', severity: 'anomaly', message: 'An approval remains unresolved.' });
  if (missingAttribution) anomalies.push({ code: 'missing_attribution', severity: 'anomaly', message: 'Project or task attribution is missing.' });
  if (modelUsageWithoutCost) warnings.push({ code: 'model_usage_without_cost', severity: 'warning', message: 'Model usage is missing an estimated cost.' });
  if (repeatedFailures > 1) anomalies.push({ code: 'repeated_failures', severity: 'anomaly', message: 'Repeated failures were detected in the loop.' });
  if (repeatedProviderRetries > 1) warnings.push({ code: 'provider_retries', severity: 'warning', message: 'Repeated provider retries were detected.' });
  if (repeatedPatchNoops > 0) warnings.push({ code: 'patch_noop', severity: 'warning', message: 'Patch no-op errors were detected.' });
  if (artifactChangedWithoutCompletion) warnings.push({ code: 'artifact_without_completion', severity: 'warning', message: 'Artifact changes were recorded without loop completion.' });
  if (taskCompletedWithoutReport) warnings.push({ code: 'completion_without_report', severity: 'warning', message: 'Task completed without a report or output summary.' });
  if (historicalActives > config.maxHistoricalRunningLoops) anomalies.push({ code: 'historical_loops_marked_active', severity: 'anomaly', message: 'Too many historical loops are still marked active.' });
  if (feedback.needsReviewFromFeedback) warnings.push({ code: 'feedback_needs_review', severity: 'warning', message: 'Feedback indicates the loop needs review.' });

  const p = config.penalties;
  const scoreDeductions = [
    costTooHigh ? p.costPenalty : 0,
    tokenUsage ? p.tokenPenalty : 0,
    durationTooLong ? p.durationPenalty : 0,
    staleFlag ? p.stalePenalty : 0,
    repeatedFailures > 1 ? p.repeatedFailuresPenalty : 0,
    repeatedProviderRetries > 1 ? p.providerRetryPenalty : 0,
    repeatedPatchNoops > 0 ? p.patchNoopPenalty : 0,
    unresolvedApprovals ? p.unresolvedApprovalPenalty : 0,
    highRiskWithoutMitigation ? p.highRiskPenalty : 0,
    artifactChangedWithoutCompletion ? p.artifactWithoutCompletionPenalty : 0,
    taskCompletedWithoutReport ? p.completionWithoutReportPenalty : 0,
    missingAttribution ? p.missingAttributionPenalty : 0,
    modelUsageWithoutCost ? p.modelUsageWithoutCostPenalty : 0,
    historicalActives > config.maxHistoricalRunningLoops ? p.historicalActivesPenalty : 0,
    explainability.decisionCount > 0 && explainability.explainedDecisionCount === 0 ? p.explainabilityMissingPenalty : 0,
    decisionMissingExplanation ? p.decisionMissingExplanationPenalty : 0,
    feedback.needsReviewFromFeedback ? p.feedbackNeedsReviewPenalty : 0,
  ].reduce((sum, v) => sum + v, 0);

  const oversightScore = Math.max(0, 100 - scoreDeductions);
  const oversightLevel: 'healthy' | 'watch' | 'needs_review' | 'critical' = oversightScore >= 80 ? 'healthy' : oversightScore >= 60 ? 'watch' : oversightScore >= 40 ? 'needs_review' : 'critical';

  const recommendedAction: any = (() => {
    if (missingAttribution) return 'fix_attribution';
    if (oversightLevel === 'critical' || repeatedFailures > 1 || repeatedPatchNoops > 0 || historicalActives > config.maxHistoricalRunningLoops) return 'stop_or_handoff';
    if (unresolvedApprovals || highRiskWithoutMitigation) return 'approve_required';
    if (!isCompleted && (staleByAge || durationTooLong)) return 'investigate_stale_loop';
    if (costTooHigh || tokenUsage || modelUsageWithoutCost) return 'investigate_cost';
    if (decisionMissingExplanation) return 'add_explanation';
    if (warnings.length > 0 || anomalies.length > 0) return 'review';
    return 'continue';
  })();

  return { oversightScore, oversightLevel, recommendedAction, warnings, anomalies, explainability, feedback, config };
}
