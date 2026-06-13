import type {
  CaseApprovalRecord,
  CaseApprovalRequestInput,
  CaseApprovalResolutionInput,
  CaseAttachment,
  CaseAttachmentInput,
  CaseAttachmentType,
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
  Participant,
  ParticipantInput,
  ParticipantRole,
  ParticipantType,
} from './caseTypes';

type CaseFileData = Omit<
  CaseFile,
  | 'attachArtifact'
  | 'removeAttachment'
  | 'listAttachments'
  | 'addParticipant'
  | 'removeParticipant'
  | 'listParticipants'
  | 'getParticipant'
  | 'hasParticipant'
>;

const CASE_ATTACHMENT_TYPES = new Set<CaseAttachmentType>([
  'file',
  'directory',
  'url',
  'report',
  'image',
  'document',
  'pull_request',
  'issue',
  'log',
  'other',
]);

function now(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimText(value: string): string {
  return value.trim();
}

function normalizeStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => trimText(String(value)))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
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

function normalizeAttachmentType(type: string): CaseAttachmentType {
  const normalized = trimText(type) as CaseAttachmentType;
  if (!CASE_ATTACHMENT_TYPES.has(normalized)) {
    throw new Error(`Unsupported attachment type: ${type}`);
  }
  return normalized;
}

function cloneMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  return { ...metadata };
}

function cloneAttachment(entry: CaseAttachment): CaseAttachment {
  return {
    ...entry,
    metadata: cloneMetadata(entry.metadata),
  };
}

function normalizeParticipantType(type: string): ParticipantType {
  const normalized = trimText(type).toLowerCase();
  if (normalized === 'agent' || normalized === 'human' || normalized === 'system') {
    return normalized;
  }
  throw new Error(`Unsupported participant type: ${type}`);
}

function normalizeParticipantRole(role: string | undefined): ParticipantRole {
  if (!role) {
    return 'other';
  }
  const normalized = trimText(role).toLowerCase();
  if (
    normalized === 'owner' ||
    normalized === 'implementer' ||
    normalized === 'reviewer' ||
    normalized === 'approver' ||
    normalized === 'observer' ||
    normalized === 'operator' ||
    normalized === 'other'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported participant role: ${role}`);
}

function normalizeParticipantInput(input: ParticipantInput): Participant {
  return {
    id: requireNonEmpty(input.id, 'participant id'),
    name: requireNonEmpty(input.name, 'participant name'),
    type: normalizeParticipantType(input.type),
    role: normalizeParticipantRole(input.role),
    createdAt: input.createdAt ? trimText(input.createdAt) : now(),
  };
}

function cloneParticipant(participant: Participant): Participant {
  return { ...participant };
}

function cloneParticipantDirectory(
  participants?: Participant[],
): Participant[] | undefined {
  if (!participants) {
    return undefined;
  }
  return participants.map(cloneParticipant);
}

function normalizeParticipantDirectory(
  participants?: ParticipantInput[],
): Participant[] {
  if (!Array.isArray(participants)) {
    return [];
  }

  const seenIds = new Set<string>();
  return participants.map((participant) => {
    const normalized = normalizeParticipantInput(participant);
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate participant id: ${normalized.id}`);
    }
    seenIds.add(normalized.id);
    return normalized;
  });
}

function legacyParticipantFromId(
  caseFile: CaseFileData,
  participantId: string,
): Participant {
  return {
    id: participantId,
    name: participantId,
    type: 'agent',
    role: participantId === caseFile.owner ? 'owner' : 'observer',
    createdAt: caseFile.createdAt,
  };
}

function listParticipantsFromCaseFile(caseFile: CaseFileData): Participant[] {
  const explicit = caseFile.participantDirectory ?? [];
  const explicitIds = new Set(explicit.map((participant) => participant.id));
  const participants: Participant[] = explicit.map(cloneParticipant);

  if (!explicitIds.has(caseFile.owner)) {
    participants.unshift({
      id: caseFile.owner,
      name: caseFile.owner,
      type: 'agent',
      role: 'owner',
      createdAt: caseFile.createdAt,
    });
  }

  for (const participantId of caseFile.participants) {
    if (!explicitIds.has(participantId) && !participants.some((entry) => entry.id === participantId)) {
      participants.push(legacyParticipantFromId(caseFile, participantId));
    }
  }

  return participants;
}

function getParticipantFromCaseFile(
  caseFile: CaseFileData,
  participantId: string,
): Participant | undefined {
  const normalizedParticipantId = requireNonEmpty(participantId, 'participantId');
  const explicit = caseFile.participantDirectory?.find(
    (participant) => participant.id === normalizedParticipantId,
  );
  if (explicit) {
    return cloneParticipant(explicit);
  }

  if (caseFile.owner === normalizedParticipantId || caseFile.participants.includes(normalizedParticipantId)) {
    return legacyParticipantFromId(caseFile, normalizedParticipantId);
  }

  return undefined;
}

function hasParticipantInCaseFile(
  caseFile: CaseFileData,
  participantId: string,
): boolean {
  return Boolean(getParticipantFromCaseFile(caseFile, participantId));
}

function ensureParticipantExists(
  caseFile: CaseFileData,
  participantId: string | undefined,
  fieldName: string,
): void {
  if (!participantId) {
    return;
  }
  if (!hasParticipantInCaseFile(caseFile, participantId)) {
    throw new Error(`Participant not found for ${fieldName}: ${participantId}`);
  }
}

function ensureUniqueParticipantId(caseFile: CaseFileData, participantId: string): void {
  if (hasParticipantInCaseFile(caseFile, participantId)) {
    throw new Error(`Participant already exists: ${participantId}`);
  }
}
function cloneCaseFile(caseFile: CaseFileData): CaseFileData {
    return {
      ...caseFile,
      participants: [...caseFile.participants],
      participantDirectory: cloneParticipantDirectory(caseFile.participantDirectory),
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
        attachmentIds: [...entry.attachmentIds],
      })),
      attachments: caseFile.attachments.map(cloneAttachment),
    };
  }

function enhanceCaseFile(caseFile: CaseFileData): CaseFile {
  Object.defineProperties(caseFile, {
    attachArtifact: {
      enumerable: false,
      value: (input: CaseAttachmentInput) => attachArtifact(caseFile as CaseFile, input),
    },
    removeAttachment: {
      enumerable: false,
      value: (attachmentId: string) => removeAttachment(caseFile as CaseFile, attachmentId),
    },
    listAttachments: {
      enumerable: false,
      value: () => listAttachments(caseFile as CaseFile),
    },
    addParticipant: {
      enumerable: false,
      value: (input: ParticipantInput) => addParticipant(caseFile as CaseFile, input),
    },
    removeParticipant: {
      enumerable: false,
      value: (participantId: string) => removeParticipant(caseFile as CaseFile, participantId),
    },
    listParticipants: {
      enumerable: false,
      value: () => listParticipants(caseFile as CaseFile),
    },
    getParticipant: {
      enumerable: false,
      value: (participantId: string) => getParticipant(caseFile as CaseFile, participantId),
    },
    hasParticipant: {
      enumerable: false,
      value: (participantId: string) => hasParticipant(caseFile as CaseFile, participantId),
    },
  });

  return caseFile as CaseFile;
}

function withUpdatedCaseFile(
  caseFile: CaseFileData,
  updater: (draft: CaseFileData) => void,
): CaseFile {
  const draft = cloneCaseFile(caseFile);
  updater(draft);
  draft.updatedAt = now();
  return enhanceCaseFile(draft);
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

function ensureParticipants(owner: string, participants?: string[]): string[] {
  const merged = normalizeStringArray([owner, ...(participants ?? [])]);
  return merged.length > 0 ? merged : [trimText(owner)];
}

function isCaseApprovalActive(approval: CaseApprovalRecord): boolean {
  return approval.status === 'requested';
}

function requireNonEmpty(value: string | undefined, fieldName: string): string {
  const trimmed = trimText(value ?? '');
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function resolveHandoffOwner(input: CaseHandoffInput, fallback: string): string {
  return requireNonEmpty(
    input.currentOwner ?? input.from ?? fallback,
    'currentOwner/from',
  );
}

function resolveHandoffNextOwner(input: CaseHandoffInput): string {
  return requireNonEmpty(input.nextOwner ?? input.to, 'nextOwner/to');
}

function resolveHandoffNotes(input: CaseHandoffInput): string {
  return requireNonEmpty(input.handoffNotes ?? input.notes, 'handoffNotes/notes');
}

function ensureAttachmentIdsExist(caseFile: CaseFile, attachmentIds: string[]): void {
  const knownIds = new Set(caseFile.attachments.map((attachment) => attachment.id));
  attachmentIds.forEach((attachmentId) => {
    if (!knownIds.has(attachmentId)) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }
  });
}

export function createCaseFile(input: CaseFileCreateInput): CaseFile {
  const timestamp = now();
  return enhanceCaseFile({
    id: createId('case'),
    goal: trimText(input.goal),
    owner: trimText(input.owner),
    project: trimText(input.project),
    participants: ensureParticipants(input.owner, input.participants),
    participantDirectory: normalizeParticipantDirectory(input.participantDirectory),
    status: normalizeStatus(input.status),
    contextTrail: [],
    decisionLog: [],
    riskLog: [],
    approvals: [],
    handoffRecords: [],
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: null,
  });
}

export function addCaseContext(
  caseFile: CaseFile,
  input: CaseContextInput,
): CaseFile {
  ensureParticipantExists(caseFile, input.createdBy, 'createdBy');
  const entry: CaseContextEntry = {
    id: createId('context'),
    timestamp: now(),
    contextUsed: trimText(input.contextUsed),
    references: normalizeStringArray(input.references),
    notes: normalizeStringArray(input.notes),
    createdBy: input.createdBy ? trimText(input.createdBy) : undefined,
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.contextTrail.push(entry);
  });
}

export function recordCaseDecision(
  caseFile: CaseFile,
  input: CaseDecisionInput,
): CaseFile {
  ensureParticipantExists(caseFile, input.createdBy, 'createdBy');
  const entry: CaseDecisionEntry = {
    id: createId('decision'),
    timestamp: now(),
    decision: trimText(input.decision),
    rationale: trimText(input.rationale),
    owner: input.owner ? trimText(input.owner) : undefined,
    relatedContextIds: normalizeStringArray(input.relatedContextIds),
    createdBy: input.createdBy ? trimText(input.createdBy) : undefined,
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.decisionLog.push(entry);
  });
}

export function recordCaseRisk(
  caseFile: CaseFile,
  input: CaseRiskInput,
): CaseFile {
  ensureParticipantExists(caseFile, input.createdBy, 'createdBy');
  const entry: CaseRiskEntry = {
    id: createId('risk'),
    timestamp: now(),
    risk: trimText(input.risk),
    severity: input.severity as CaseRiskSeverity,
    mitigation: trimText(input.mitigation),
    status: input.status ?? 'open',
    createdBy: input.createdBy ? trimText(input.createdBy) : undefined,
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.riskLog.push(entry);
  });
}

export function attachArtifact(
  caseFile: CaseFileData,
  input: CaseAttachmentInput,
): CaseFile {
  const entry: CaseAttachment = {
    id: createAttachmentId(),
    type: normalizeAttachmentType(input.type),
    label: requireNonEmpty(input.label, 'label'),
    createdAt: now(),
    path: input.path ? trimText(input.path) : undefined,
    url: input.url ? trimText(input.url) : undefined,
    description: input.description ? trimText(input.description) : undefined,
    metadata: cloneMetadata(input.metadata),
  };

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.attachments.push(entry);
  });
}

export function removeAttachment(
  caseFile: CaseFileData,
  attachmentId: string,
): CaseFile {
  const normalizedAttachmentId = requireNonEmpty(attachmentId, 'attachmentId');

  return withUpdatedCaseFile(caseFile, (draft) => {
    const before = draft.attachments.length;
    draft.attachments = draft.attachments.filter(
      (entry) => entry.id !== normalizedAttachmentId,
    );
    if (draft.attachments.length === before) {
      throw new Error(`Attachment not found: ${normalizedAttachmentId}`);
    }
  });
}

export function listAttachments(caseFile: CaseFileData): CaseAttachment[] {
  return caseFile.attachments.map(cloneAttachment);
}

export function addParticipant(
  caseFile: CaseFile,
  input: ParticipantInput,
): CaseFile {
  const participant = normalizeParticipantInput(input);
  ensureUniqueParticipantId(caseFile, participant.id);

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.participantDirectory = [...(draft.participantDirectory ?? []), participant];
    if (!draft.participants.includes(participant.id)) {
      draft.participants.push(participant.id);
    }
  });
}

export function removeParticipant(
  caseFile: CaseFile,
  participantId: string,
): CaseFile {
  const normalizedParticipantId = requireNonEmpty(participantId, 'participantId');

  return withUpdatedCaseFile(caseFile, (draft) => {
    draft.participantDirectory = (draft.participantDirectory ?? []).filter(
      (participant) => participant.id !== normalizedParticipantId,
    );
    draft.participants = draft.participants.filter(
      (entry) => entry !== normalizedParticipantId,
    );
  });
}

export function listParticipants(caseFile: CaseFileData): Participant[] {
  return listParticipantsFromCaseFile(caseFile).map(cloneParticipant);
}

export function getParticipant(
  caseFile: CaseFileData,
  participantId: string,
): Participant | undefined {
  const participant = getParticipantFromCaseFile(caseFile, participantId);
  return participant ? cloneParticipant(participant) : undefined;
}

export function hasParticipant(
  caseFile: CaseFileData,
  participantId: string,
): boolean {
  return hasParticipantInCaseFile(caseFile, participantId);
}

export function requestCaseApproval(
  caseFile: CaseFile,
  input: CaseApprovalRequestInput,
): CaseFile {
  ensureParticipantExists(caseFile, input.requestedByParticipantId, 'requestedByParticipantId');
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
    requestedByParticipantId: input.requestedByParticipantId
      ? trimText(input.requestedByParticipantId)
      : undefined,
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
  ensureParticipantExists(caseFile, input.resolvedByParticipantId, 'resolvedByParticipantId');
  return withUpdatedCaseFile(caseFile, (draft) => {
    const approval = draft.approvals.find((entry) => entry.id === approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    approval.status = input.status;
    approval.approver = trimText(input.approver);
    approval.note = input.note ? trimText(input.note) : null;
    approval.resolvedAt = now();
    approval.resolvedByParticipantId = input.resolvedByParticipantId
      ? trimText(input.resolvedByParticipantId)
      : undefined;

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

export function recordHandoff(caseFile: CaseFile, input: CaseHandoffInput): CaseFile {
  const currentOwner = resolveHandoffOwner(input, caseFile.owner);
  const nextOwner = resolveHandoffNextOwner(input);
  const handoffNotes = resolveHandoffNotes(input);
  const attachmentIds = normalizeStringArray(input.attachmentIds);

  ensureParticipantExists(caseFile, input.fromParticipantId, 'fromParticipantId');
  ensureParticipantExists(caseFile, input.toParticipantId, 'toParticipantId');
  ensureAttachmentIdsExist(caseFile, attachmentIds);

  const entry: CaseHandoffRecord = {
    id: createId('handoff'),
    timestamp: now(),
    currentOwner,
    nextOwner,
    handoffNotes,
    recommendedNextActions: normalizeStringArray(input.recommendedNextActions),
    references: normalizeStringArray(input.references),
    attachmentIds,
    fromParticipantId: input.fromParticipantId ? trimText(input.fromParticipantId) : undefined,
    toParticipantId: input.toParticipantId ? trimText(input.toParticipantId) : undefined,
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
