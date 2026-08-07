import type { HandoffManifest } from './caseTypes';
import type { ScenarioContract } from './scenarioLoop';

export interface HandoffGovernanceRequest {
  manifest: HandoffManifest;
  inheritedContract: ScenarioContract;
  requestedContract?: ScenarioContract;
}

export interface HandoffGovernanceDecision {
  allowed: boolean;
  reasons: string[];
  effectiveContract: ScenarioContract;
}

function normalize(values?: string[]): string[] {
  return Array.isArray(values)
    ? Array.from(new Set(values.map((value) => value.trim()).filter(Boolean).map((value) => value.toLowerCase())))
    : [];
}

function containsAllWithin(parent?: string[], child?: string[]): boolean {
  const parentValues = normalize(parent);
  const childValues = normalize(child);
  if (parentValues.length === 0) return true;
  return childValues.every((value) => parentValues.some((allowed) => value.includes(allowed) || allowed.includes(value)));
}

function preservesInherited(values?: string[], requested?: string[]): boolean {
  const inheritedValues = normalize(values);
  const requestedValues = normalize(requested);
  return inheritedValues.every((value) => requestedValues.some((candidate) => candidate.includes(value) || value.includes(candidate)));
}

export function evaluateHandoffGovernance(request: HandoffGovernanceRequest): HandoffGovernanceDecision {
  const reasons: string[] = [];
  const inherited = request.inheritedContract;
  const requested = request.requestedContract ?? inherited;

  if (request.manifest.pendingApprovals.length > 0) {
    reasons.push('Handoff contains pending approvals that must be resolved before privilege expansion.');
  }
  if (request.manifest.openRisks.some((risk) => risk.severity === 'high' || risk.severity === 'critical')) {
    reasons.push('Handoff contains high or critical open risks.');
  }
  if (!containsAllWithin(inherited.allowedCommands, requested.allowedCommands)) {
    reasons.push('Requested handoff contract broadens allowed commands.');
  }
  if (!containsAllWithin(inherited.allowedTargets, requested.allowedTargets)) {
    reasons.push('Requested handoff contract broadens allowed targets.');
  }
  if (!preservesInherited(inherited.blockedCommands, requested.blockedCommands)) {
    reasons.push('Requested handoff contract removes inherited blocked commands.');
  }
  if (!preservesInherited(inherited.blockedTargets, requested.blockedTargets)) {
    reasons.push('Requested handoff contract removes inherited blocked targets.');
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ['Handoff preserves inherited scenario constraints.'],
    effectiveContract: { ...inherited },
  };
}
