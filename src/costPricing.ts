import { readJsonFile, resolveSafeloopPath, writeJsonFile, type SafeloopStorageOptions } from './localStorage';

export interface ModelPricingDefinition {
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  currency?: string;
}

export interface UsageCostResult {
  provider: string;
  model: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

const PRICING_FILE = 'model-pricing.json';

function pricingKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePricing(definition: ModelPricingDefinition): ModelPricingDefinition {
  return {
    provider: normalizeText(definition.provider),
    model: normalizeText(definition.model),
    inputPerMillion: Number(definition.inputPerMillion),
    outputPerMillion: Number(definition.outputPerMillion),
    currency: normalizeText(definition.currency) || 'USD',
  };
}

export function readModelPricing(options: SafeloopStorageOptions = {}): ModelPricingDefinition[] {
  const filePath = resolveSafeloopPath(PRICING_FILE, options);
  return readJsonFile<ModelPricingDefinition[]>(filePath, []);
}

export function setModelPricing(
  definition: ModelPricingDefinition | ModelPricingDefinition[],
  options: SafeloopStorageOptions = {},
): ModelPricingDefinition[] {
  const items = Array.isArray(definition) ? definition : [definition];
  const normalized = items.map(normalizePricing);
  const existing = readModelPricing(options);
  const byKey = new Map(existing.map((item) => [pricingKey(item.provider, item.model), item] as const));
  normalized.forEach((item) => byKey.set(pricingKey(item.provider, item.model), item));
  const merged = Array.from(byKey.values());
  writeJsonFile(resolveSafeloopPath(PRICING_FILE, options), merged);
  return merged;
}

export function lookupPricing(
  provider: string,
  model: string,
  options: SafeloopStorageOptions = {},
): ModelPricingDefinition | undefined {
  return readModelPricing(options).find(
    (definition) => pricingKey(definition.provider, definition.model) === pricingKey(provider, model),
  );
}

export function calculateUsageCost(
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  },
  options: SafeloopStorageOptions = {},
): UsageCostResult {
  const pricing = lookupPricing(usage.provider, usage.model, options);
  const currency = pricing?.currency ?? 'USD';
  const inputCost = pricing ? (Number(usage.inputTokens) / 1_000_000) * pricing.inputPerMillion : 0;
  const outputCost = pricing ? (Number(usage.outputTokens) / 1_000_000) * pricing.outputPerMillion : 0;
  return {
    provider: usage.provider,
    model: usage.model,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency,
  };
}
