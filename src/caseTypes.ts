export type CaseFileStatus =
  | 'open'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'handed_off';

export type CaseRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type CaseApprovalStatus = 'requested' | 'approved' | 'rejected';

export type CaseAttachmentType =
  | 'file'
  | 'directory'
  | 'url'
  | 'report'
  | 'image'
  | 'document'
  | 'pull_request'
  | 'issue'
  | 'log'
  | 'other';

export type ParticipantType = 'agent' | 'human' | 'system';

export type ParticipantRole =
  | 'owner'
  | 'implementer'
  | 'reviewer'
  | 'approver'
  | 'observer'
  | 'operator'
  | 'other';

export interface Participant {
  id: string;
  name: string;
  type: ParticipantType;
  role: ParticipantRole;
  createdAt: string;
}

export interface ParticipantInput {
  id: string;
  name: string;
  type: ParticipantType;
  role?: ParticipantRole;
  createdAt?: string;
}

export interface CaseAttachment {
  id: string;
  type: CaseAttachmentType;
  label: string;
  createdAt: string;
  path?: string;
  url?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CaseAttachmentInput {
  type: CaseAttachmentType;
  label: string;
  path?: string;
  url?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CaseContextEntry {
  id: string;
  timestamp: string;
  contextUsed: string;
  references: string[];
  notes: string[];
  createdBy?: string;
}

export interface CaseDecisionEntry {
  id: string;
  timestamp: string;
  decision: string;
  rationale: string;
  owner?: string;
  relatedContextIds: string[];
  createdBy?: string;
}

export interface CaseRiskEntry {
  id: string;
  timestamp: string;
  risk: string;
  severity: CaseRiskSeverity;
  mitigation: string;
  status: 'open' | 'accepted' | 'mitigated';
  createdBy?: string;
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
  requestedByParticipantId?: string;
  resolvedByParticipantId?: string;
}

export interface CaseHandoffRecord {
  id: string;
  timestamp: string;
  currentOwner: string;
  nextOwner: string;
  handoffNotes: string;
  recommendedNextActions: string[];
  references: string[];
  attachmentIds: string[];
  fromParticipantId?: string;
  toParticipantId?: string;
}

export interface CaseFile {
  id: string;
  goal: string;
  owner: string;
  project: string;
  participants: string[];
  participantDirectory?: Participant[];
  status: CaseFileStatus;
  contextTrail: CaseContextEntry[];
  decisionLog: CaseDecisionEntry[];
  riskLog: CaseRiskEntry[];
  approvals: CaseApprovalRecord[];
  handoffRecords: CaseHandoffRecord[];
  attachments: CaseAttachment[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  attachArtifact(input: CaseAttachmentInput): CaseFile;
  removeAttachment(attachmentId: string): CaseFile;
  listAttachments(): CaseAttachment[];
  addParticipant(input: ParticipantInput): CaseFile;
  removeParticipant(participantId: string): CaseFile;
  listParticipants(): Participant[];
  getParticipant(participantId: string): Participant | undefined;
  hasParticipant(participantId: string): boolean;
}

export interface CaseFileCreateInput {
  goal: string;
  owner: string;
  project: string;
  participants?: string[];
  participantDirectory?: ParticipantInput[];
  status?: CaseFileStatus;
}

export interface CaseContextInput {
  contextUsed: string;
  references?: string[];
  notes?: string[];
  createdBy?: string;
}

export interface CaseDecisionInput {
  decision: string;
  rationale: string;
  owner?: string;
  relatedContextIds?: string[];
  createdBy?: string;
}

export interface CaseRiskInput {
  risk: string;
  severity: CaseRiskSeverity;
  mitigation: string;
  status?: CaseRiskEntry['status'];
  createdBy?: string;
}

export interface CaseApprovalRequestInput {
  subject: string;
  requestedBy: string;
  requestedFor?: string;
  reason?: string;
  references?: string[];
  requestedByParticipantId?: string;
}

export interface CaseApprovalResolutionInput {
  status: 'approved' | 'rejected';
  approver: string;
  note?: string;
  resolvedByParticipantId?: string;
}

export interface CaseHandoffInput {
  currentOwner?: string;
  from?: string;
  nextOwner?: string;
  to?: string;
  handoffNotes?: string;
  notes?: string;
  recommendedNextActions?: string[];
  references?: string[];
  attachmentIds?: string[];
  fromParticipantId?: string;
  toParticipantId?: string;
}

export interface CaseReportSummary {
  contextEntries: number;
  decisions: number;
  risks: number;
  approvals: number;
  handoffs: number;
  attachments: number;
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
