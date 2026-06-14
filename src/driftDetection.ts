export type GoalDriftStatus = 'on_track' | 'possible_drift' | 'high_drift';

export interface GoalDriftInput {
  originalGoal: string;
  artifactsChanged: string[];
  decisionsMade: string[];
  risksAdded: string[];
}

export interface GoalDriftResult {
  status: GoalDriftStatus;
  score: number;
  matchedTerms: string[];
  reasons: string[];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function detectGoalDrift(input: GoalDriftInput): GoalDriftResult {
  const goalTerms = new Set(tokenize(input.originalGoal));
  const artifactTerms = tokenize(input.artifactsChanged.join(' '));
  const decisionTerms = tokenize(input.decisionsMade.join(' '));
  const riskTerms = tokenize(input.risksAdded.join(' '));
  const evidenceTerms = unique([...artifactTerms, ...decisionTerms, ...riskTerms]);
  const matchedTerms = unique(evidenceTerms.filter((term) => goalTerms.has(term)));
  const artifactOverlap = goalTerms.size === 0 ? 0 : unique(artifactTerms.filter((term) => goalTerms.has(term))).length / goalTerms.size;
  const evidenceOverlap = goalTerms.size === 0 ? 0 : matchedTerms.length / goalTerms.size;
  const breadth = input.artifactsChanged.length;

  let status: GoalDriftStatus = 'on_track';
  const reasons: string[] = [];

  if (breadth >= 4) {
    status = evidenceOverlap < 0.25 ? 'high_drift' : 'possible_drift';
    reasons.push('Changed files extend beyond the original goal');
    if (status === 'high_drift') {
      reasons.push('Work diverged materially from the stated goal');
    }
  } else if (breadth >= 3) {
    status = 'possible_drift';
    reasons.push('Work expands beyond the original goal into related areas');
  } else if (breadth >= 2 && artifactOverlap < 0.5) {
    status = 'possible_drift';
    reasons.push('Work touches additional areas beyond the original goal');
  }

  if (input.risksAdded.length > 0) {
    reasons.push(`${input.risksAdded.length} risk${input.risksAdded.length === 1 ? '' : 's'} added during work`);
  }

  if (status === 'on_track' && evidenceOverlap === 0 && breadth > 1) {
    status = 'possible_drift';
    reasons.push('No strong overlap between the original goal and the work performed');
  }

  return {
    status,
    score: Math.max(0, Math.min(100, Math.round(evidenceOverlap * 100) - Math.min(50, breadth * 5))),
    matchedTerms,
    reasons: reasons.length > 0 ? reasons : ['Work stays aligned with the stated goal'],
  };
}
