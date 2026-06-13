import type {
  CaseApprovalRecord,
  CaseApprovalRequestInput,
  CaseApprovalResolutionInput,
  CaseContextEntry,
  CaseContextInput,
  CaseDecisionEntry,
  CaseDecisionInput,
  CaseFile,
  CaseFileCreateInput,
  CaseFileStatus,
  CaseHandoffInput,
  CaseHandoffRecord,
  CaseRiskEntry,
  CaseRiskInput,
  CaseRiskSeverity,
} from './caseTypes';

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trimText(value: string): string {
  return value.trim();
}

function normalizeStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => trimText(String(value)))
    .filter((value) => value.length > 0);
  return [...new Set(normalized)];
}

function normalizeStatus(status?: CaseFileStatus): CaseFileStatus {
  switch (status) {
    case 'awaiting_approval':
    case 'blocked':
    case 'completed':
    case 'handed_off':
    case 'open':
      return status;
    default:
      return 'open';
  }
}

function cloneCaseFile(caseFile: CaseFile): CaseFile {
  return {
    ...caseFile,
    participants: [...caseFile.participants],
    contextTrail: caseFile.contextTrail.map((entry) => ({
      ...entry,
      references: [...entry.references],
      notes: [...entry.notes],
    })),
    decisionLog: caseFile.decisionLog.map((entry) => ({
      ...entry,
      relatedContextIds: [...entry.relatedContextIds],
    })),
    riskLog: caseFile.riskLog.map((entry) => ({ ...entry })),
    approvals: caseFile.approvals.map((entry) => ({
      ...entry,
      references: [...entry.references],
    })),
    handoffRecords: caseFile.handoffRecords.map((entry) => ({
      ...entry,
      recommendedNextActions: [...entry.recommendedNextActions],
      references: [...entry.references],
    })),
  };
}

function withUpdatedCaseFile(
  caseFile: CaseFile,
  updater: (draft: CaseFile) => void,
): CaseFile {
  const draft = cloneCaseFile(caseFile);
  updater(draft);
  draft.updatedAt = now();
  return draft;
}

function updateStatus(caseFile: CaseFile, status: CaseFileStatus): CaseFile {
  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.status = status;
    if (status === 'completed' || status === 'handed_off') {
      draft.closedAt = draft.closedAt ?? now();
    }
    if (status === 'open' || status === 'awaiting_approval' || status === 'blocked') {
      draft.closedAt = null;
    }
  });
}

function ensureParticipants(
  owner: string,
  participants?: string[],
): string[] {
  const merged = normalizeStringArray([owner, ...(participants ?? [])]);
  return merged.length > 0 ? merged : [trimText(owner)];
}

function isCaseApprovalActive(approval: CaseApprovalRecord): boolean {
  return approval.status === 'requested';
}

export function createCaseFile(input: CaseFileCreateInput): CaseFile {
  const timestamp = now();
  return {
    id: createId('case'),
    goal: trimText(input.goal),
    owner: trimText(input.owner),
    project: trimText(input.project),
    participants: ensureParticipants(input.owner, input.participants),
    status: normalizeStatus(input.status),
    contextTrail: [],
    decisionLog: [],
    riskLog: [],
    approvals: [],
    handoffRecords: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: null,
  };
}

export function addCaseContext(
  caseFile: CaseFile,
  input: CaseContextInput,
): CaseFile {
  const entry: CaseContextEntry = {
    id: createId('context'),
    timestamp: now(),
    contextUsed: trimText(input.contextUsed),
    references: normalizeStringArray(input.references),
    notes: normalizeStringArray(input.notes),
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.contextTrail.push(entry);
  });
}

export function recordCaseDecision(
  caseFile: CaseFile,
  input: CaseDecisionInput,
): CaseFile {
  const entry: CaseDecisionEntry = {
    id: createId('decision'),
    timestamp: now(),
    decision: trimText(input.decision),
    rationale: trimText(input.rationale),
    owner: input.owner ? trimText(input.owner) : undefined,
    relatedContextIds: normalizeStringArray(input.relatedContextIds),
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.decisionLog.push(entry);
  });
}

export function recordCaseRisk(
  caseFile: CaseFile,
  input: CaseRiskInput,
): CaseFile {
  const entry: CaseRiskEntry = {
    id: createId('risk'),
    timestamp: now(),
    risk: trimText(input.risk),
    severity: input.severity as CaseRiskSeverity,
    mitigation: trimText(input.mitigation),
    status: input.status ?? 'open',
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.riskLog.push(entry);
  });
}

export function requestCaseApproval(
  caseFile: CaseFile,
  input: CaseApprovalRequestInput,
): CaseFile {
  const timestamp = now();
  const entry: CaseApprovalRecord = {
    id: createId('approval'),
    timestamp,
    subject: trimText(input.subject),
    requestedBy: trimText(input.requestedBy),
    requestedFor: trimText(input.requestedFor ?? caseFile.owner),
    reason: trimText(input.reason ?? ''),
    references: normalizeStringArray(input.references),
    status: 'requested',
    approver: null,
    note: null,
    requestedAt: timestamp,
    resolvedAt: null,
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.approvals.push(entry);
    draft.status = 'awaiting_approval';
  });
}

export function resolveCaseApproval(
  caseFile: CaseFile,
  approvalId: string,
  input: CaseApprovalResolutionInput,
): CaseFile {
  return withUpdatedCaseFile(caseFile, (draft) => {
    const approval = draft.approvals.find((entry) => entry.id === approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    approval.status = input.status;
    approval.approver = trimText(input.approver);
    approval.note = input.note ? trimText(input.note) : null;
    approval.resolvedAt = now();

    const anyPendingApproval = draft.approvals.some(isCaseApprovalActive);
    if (input.status === 'rejected') {
      draft.status = 'blocked';
      draft.closedAt = null;
      return;
    }

    draft.status = anyPendingApproval ? 'awaiting_approval' : 'open';
    if (draft.status === 'open') {
      draft.closedAt = null;
    }
  });
}

export function recordHandoff(
  caseFile: CaseFile,
  input: CaseHandoffInput,
): CaseFile {
  const entry: CaseHandoffRecord = {
    id: createId('handoff'),
    timestamp: now(),
    currentOwner: trimText(input.currentOwner ?? caseFile.owner),
    nextOwner: trimText(input.nextOwner),
    handoffNotes: trimText(input.handoffNotes),
    recommendedNextActions: normalizeStringArray(input.recommendedNextActions),
    references: normalizeStringArray(input.references),
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.handoffRecords.push(entry);
    draft.owner = entry.nextOwner;
    if (!draft.participants.includes(entry.nextOwner)) {
      draft.participants.push(entry.nextOwner);
    }
    draft.status = 'handed_off';
    draft.closedAt = now();
  });
}

export function setCaseStatus(
  caseFile: CaseFile,
  status: CaseFileStatus,
): CaseFile {
  return updateStatus(caseFile, status);
}
