export type ReadinessRiskSeverity = 'low' | 'medium' | 'high';
export type ReadinessApprovalStatus = 'approved' | 'pending' | 'rejected';

export interface ReadinessRiskInput {
  severity: ReadinessRiskSeverity;
  status?: 'open' | 'accepted' | 'mitigated';
}

export interface ReadinessScoreInput {
  risks: ReadinessRiskInput[];
  approvals: ReadinessApprovalStatus[] | { status: ReadinessApprovalStatus }[];
  attachments: string[];
  evidence: string[];
  handoffs: string[];
  tests: { passed: boolean };
}

export interface ReadinessScoreResult {
  score: number;
  status: 'Ready' | 'Ready with review' | 'Not ready';
  blockers: string[];
  recommendations: string[];
}

function normalizeApprovalStatuses(input: ReadinessScoreInput['approvals']): ReadinessApprovalStatus[] {
  return input.map((value) => (typeof value === 'string' ? value : value.status));
}

export function calculateReadinessScore(input: ReadinessScoreInput): ReadinessScoreResult {
  let score = 100;
  const blockers: string[] = [];
  const recommendations: string[] = [];

  const openRisks = input.risks.filter((risk) => risk.status !== 'accepted' && risk.status !== 'mitigated');
  openRisks.forEach((risk) => {
    if (risk.severity === 'high') {
      score -= 20;
    } else if (risk.severity === 'medium') {
      score -= 8;
    } else {
      score -= 3;
    }
  });

  if (openRisks.length > 0) {
    blockers.push(`${openRisks.length} ${openRisks[0].severity} risk${openRisks.length === 1 ? '' : 's'} remains open`);
    recommendations.push('Resolve open risks before release');
  }

  const approvals = normalizeApprovalStatuses(input.approvals);
  const approvedCount = approvals.filter((status) => status === 'approved').length;
  const pendingCount = approvals.filter((status) => status === 'pending').length;
  const rejectedCount = approvals.filter((status) => status === 'rejected').length;

  if (rejectedCount > 0) {
    score -= 25;
    blockers.push('A required approval was rejected');
    recommendations.push('Address rejected approvals');
  }

  if (pendingCount > 0) {
    score -= 10;
    blockers.push('Approval is still pending');
    recommendations.push('Wait for approval resolution');
  }

  if (approvedCount === 0) {
    score -= 10;
    blockers.push('No approved review recorded');
  }

  if (input.attachments.length === 0) {
    score -= 5;
    blockers.push('No attachments recorded');
    recommendations.push('Attach the relevant evidence');
  }

  if (input.evidence.length === 0) {
    score -= 5;
    blockers.push('No evidence recorded');
    recommendations.push('Record explicit evidence');
  }

  if (input.handoffs.length === 0) {
    score -= 4;
    blockers.push('No handoff recorded');
    recommendations.push('Create a handoff trail');
  }

  if (!input.tests.passed) {
    score -= 12;
    blockers.push('Tests failed');
    recommendations.push('Fix failing tests');
  }

  score = Math.max(0, Math.min(100, score));

  let status: ReadinessScoreResult['status'] = 'Ready';
  if (score < 80 || rejectedCount > 0 || !input.tests.passed) {
    status = 'Not ready';
  } else if (score < 95 || openRisks.length > 0 || pendingCount > 0 || input.handoffs.length === 0) {
    status = 'Ready with review';
  }

  if (recommendations.length === 0) {
    recommendations.push('Release is ready to proceed');
  }

  return { score, status, blockers, recommendations: Array.from(new Set(recommendations)) };
}
