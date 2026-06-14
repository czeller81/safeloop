import type { SafeloopStorageOptions } from './localStorage';
import { readModelUsage } from './modelUsage';
import {
  calculateUsageCost,
  lookupPricing,
  readModelPricing,
  setModelPricing,
  type ModelPricingDefinition,
  type UsageCostResult,
} from './costPricing';
import type { ModelUsageRecord } from './modelUsage';

export interface CostCalculationResult extends UsageCostResult {}
export type { ModelPricingDefinition } from './costPricing';

export interface CaseCostSummary {
  caseId: string;
  totalCost: number;
  currency: string;
  costByAgent: Record<string, number>;
  costByModel: Record<string, number>;
  costByCase: Record<string, number>;
  usageCount: number;
}

export { readModelPricing, setModelPricing };

export function calculateCost(
  usage: ModelUsageRecord | ModelUsageRecord[],
  options: SafeloopStorageOptions = {},
): CostCalculationResult | CostCalculationResult[] {
  if (Array.isArray(usage)) {
    return usage.map((item) => calculateCost(item, options) as CostCalculationResult);
  }
  return calculateUsageCost(usage, options);
}

export function getCaseCostSummary(caseId: string | undefined = undefined, options: SafeloopStorageOptions = {}): CaseCostSummary {
  const allUsages = readModelUsage(options);
  const usages: ModelUsageRecord[] = [];
  for (const entry of allUsages) {
    if (!caseId || entry.caseId === caseId) {
      usages.push(entry);
    }
  }

  const calculations: CostCalculationResult[] = [];
  for (const entry of usages) {
    calculations.push(calculateUsageCost(entry, options));
  }

  let totalCost = 0;
  for (const entry of calculations) {
    totalCost += entry.totalCost;
  }
  const currency = calculations[0]?.currency ?? 'USD';
  const costByAgent: Record<string, number> = {};
  const costByModel: Record<string, number> = {};
  const costByCase: Record<string, number> = {};

  usages.forEach((entry: ModelUsageRecord, index: number) => {
    const cost = calculations[index]?.totalCost ?? 0;
    costByAgent[entry.agentId] = (costByAgent[entry.agentId] ?? 0) + cost;
    costByModel[entry.model] = (costByModel[entry.model] ?? 0) + cost;
    costByCase[entry.caseId] = (costByCase[entry.caseId] ?? 0) + cost;
  });

  return {
    caseId: caseId ?? 'all',
    totalCost,
    currency,
    costByAgent,
    costByModel,
    costByCase,
    usageCount: usages.length,
  };
}

export { lookupPricing };
