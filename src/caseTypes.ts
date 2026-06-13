export type CaseFileStatus =
  | 'open'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'handed_off';

export type CaseRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CaseApprovalStatus = 'requested' | 'approved' | 'rejected';

export interface CaseContextEntry {
  id: string;
  timestamp: string;
  contextUsed: string;
  references: string[];
  notes: string[];
}

export interface CaseDecisionEntry {
  id: string;
  timestamp: string;
  decision: string;
  rationale: string;
  owner?: string;
  relatedContextIds: string[];
}

export interface CaseRiskEntry {
  id: string;
  timestamp: string;
  risk: string;
  severity: CaseRiskSeverity;
  mitigation: string;
  status: 'open' | 'accepted' | 'mitigated';
}

export interface CaseApprovalRecord {
  id: string;
  timestamp: string;
  subject: string;
  requestedBy: string;
  requestedFor: string;
  reason: string;
  references: string[];
  status: CaseApprovalStatus;
  approver: string | null;
  note: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export interface CaseHandoffRecord {
  id: string;
  timestamp: string;
  currentOwner: string;
  nextOwner: string;
  handoffNotes: string;
  recommendedNextActions: string[];
  references: string[];
}

export interface CaseFile {
  id: string;
  goal: string;
  owner: string;
  project: string;
  participants: string[];
  status: CaseFileStatus;
  contextTrail: CaseContextEntry[];
  decisionLog: CaseDecisionEntry[];
  riskLog: CaseRiskEntry[];
  approvals: CaseApprovalRecord[];
  handoffRecords: CaseHandoffRecord[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface CaseFileCreateInput {
  goal: string;
  owner: string;
  project: string;
  participants?: string[];
  status?: CaseFileStatus;
}

export interface CaseContextInput {
  contextUsed: string;
  references?: string[];
  notes?: string[];
}

export interface CaseDecisionInput {
  decision: string;
  rationale: string;
  owner?: string;
  relatedContextIds?: string[];
}

export interface CaseRiskInput {
  risk: string;
  severity: CaseRiskSeverity;
  mitigation: string;
  status?: CaseRiskEntry['status'];
}

export interface CaseApprovalRequestInput {
  subject: string;
  requestedBy: string;
  requestedFor?: string;
  reason?: string;
  references?: string[];
}

export interface CaseApprovalResolutionInput {
  status: 'approved' | 'rejected';
  approver: string;
  note?: string;
}

export interface CaseHandoffInput {
  currentOwner?: string;
  nextOwner: string;
  handoffNotes: string;
  recommendedNextActions?: string[];
  references?: string[];
}

export interface CaseReportSummary {
  contextEntries: number;
  decisions: number;
  risks: number;
  approvals: number;
  handoffs: number;
  lastApprovalStatus: CaseApprovalStatus | 'none';
}

export interface CaseReportJSON {
  generatedAt: string;
  caseFile: CaseFile;
  summary: CaseReportSummary;
}

export interface CaseReportMarkdownOptions {
  includeEmptySections?: boolean;
}
