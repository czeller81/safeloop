import type {
  CaseApprovalRecord,
  CaseAttachment,
  CaseDecisionEntry,
  CaseFile,
  CaseHandoffRecord,
  CaseRiskEntry,
  HandoffManifest,
  HandoffManifestSourceCase,
  Participant,
} from './caseTypes';
import { getParticipant, listParticipants } from './caseFile';

function now(): string {
  return new Date().toISOString();
}

function cloneAttachment(attachment: CaseAttachment): CaseAttachment {
  return {
    ...attachment,
    metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
  };
}

function cloneParticipant(participant: Participant): Participant {
  return { ...participant };
}

function cloneDecision(entry: CaseDecisionEntry): CaseDecisionEntry {
  return {
    ...entry,
    relatedContextIds: [...entry.relatedContextIds],
  };
}

function cloneRisk(entry: CaseRiskEntry): CaseRiskEntry {
  return { ...entry };
}

function cloneApproval(entry: CaseApprovalRecord): CaseApprovalRecord {
  return {
    ...entry,
    references: [...entry.references],
  };
}

function cloneHandoff(entry: CaseHandoffRecord): CaseHandoffRecord {
  return {
    ...entry,
    recommendedNextActions: [...entry.recommendedNextActions],
    references: [...entry.references],
    attachmentIds: [...entry.attachmentIds],
  };
}

function normalizeStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

function safeListParticipants(caseFile: CaseFile): Participant[] {
  try {
    return listParticipants(caseFile).map(cloneParticipant);
  } catch {
    return [];
  }
}

function safeParticipantDisplayName(
  caseFile: CaseFile,
  participantId?: string | null,
): string | null {
  if (!participantId) {
    return null;
  }
  const participant = getParticipant(caseFile, participantId);
  return participant?.name ?? participantId;
}

function safeArray<T>(values?: T[]): T[] {
  return Array.isArray(values) ? values : [];
}

function pickRecentDecisions(decisions: CaseDecisionEntry[]): CaseDecisionEntry[] {
  return decisions.slice(-3).map(cloneDecision).reverse();
}

function pickRequiredAttachments(
  attachments: CaseAttachment[],
  latestHandoff?: CaseHandoffRecord,
): CaseAttachment[] {
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment] as const));
  const attachmentIds = latestHandoff?.attachmentIds ?? [];
  const sourceIds = attachmentIds.length > 0 ? attachmentIds : attachments.map((attachment) => attachment.id);
  const resolved = sourceIds
    .map((id) => attachmentById.get(id))
    .filter((attachment): attachment is CaseAttachment => Boolean(attachment));
  return resolved.map(cloneAttachment);
}

function buildRecommendedActions(
  latestHandoff: CaseHandoffRecord | undefined,
  requiredAttachments: CaseAttachment[],
  openRisks: CaseRiskEntry[],
  pendingApprovals: CaseApprovalRecord[],
  recentDecisions: CaseDecisionEntry[],
): string[] {
  if (latestHandoff && latestHandoff.recommendedNextActions.length > 0) {
    return normalizeStringArray(latestHandoff.recommendedNextActions);
  }

  const actions = [
    ...(requiredAttachments.length > 0 ? ['Review the referenced attachments'] : []),
    ...(openRisks.length > 0 ? ['Address open risks'] : []),
    ...(pendingApprovals.length > 0 ? ['Resolve pending approvals'] : []),
    ...(recentDecisions.length > 0 ? ['Review recent decisions'] : []),
  ];

  return Array.from(new Set(actions));
}

function buildSummary(
  caseFile: CaseFile,
  currentOwner: string,
  nextOwner: string,
  openRisks: CaseRiskEntry[],
  pendingApprovals: CaseApprovalRecord[],
  recentDecisions: CaseDecisionEntry[],
  requiredAttachments: CaseAttachment[],
): string {
  const segments = [
    `${caseFile.goal} is currently owned by ${currentOwner}`,
    `and should be handed to ${nextOwner}`,
  ];

  const detailParts = [
    openRisks.length > 0 ? `${openRisks.length} open risk${openRisks.length === 1 ? '' : 's'}` : 'no open risks',
    pendingApprovals.length > 0
      ? `${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? '' : 's'}`
      : 'no pending approvals',
    recentDecisions.length > 0
      ? `${recentDecisions.length} recent decision${recentDecisions.length === 1 ? '' : 's'}`
      : 'no recent decisions',
    requiredAttachments.length > 0
      ? `${requiredAttachments.length} required attachment${requiredAttachments.length === 1 ? '' : 's'}`
      : 'no required attachments',
  ];

  return `${segments.join(' ')}. This manifest highlights ${detailParts.join(', ')}.`;
}

function createSourceCase(
  caseFile: CaseFile,
  handoffs: CaseHandoffRecord[],
  openRisks: CaseRiskEntry[],
  pendingApprovals: CaseApprovalRecord[],
  recentDecisions: CaseDecisionEntry[],
): HandoffManifestSourceCase {
  const participantIds = normalizeStringArray(caseFile.participants);
  const attachmentIds = safeArray(caseFile.attachments).map((attachment) => attachment.id);
  return {
    id: caseFile.id,
    goal: caseFile.goal,
    owner: caseFile.owner,
    project: caseFile.project,
    status: caseFile.status,
    createdAt: caseFile.createdAt,
    updatedAt: caseFile.updatedAt,
    closedAt: caseFile.closedAt,
    participantIds,
    attachmentIds,
    decisionIds: recentDecisions.map((entry) => entry.id),
    openRiskIds: openRisks.map((entry) => entry.id),
    pendingApprovalIds: pendingApprovals.map((entry) => entry.id),
    handoffIds: handoffs.map((entry) => entry.id),
    latestHandoffId: handoffs.length > 0 ? handoffs[handoffs.length - 1].id : null,
  };
}

export function generateHandoffManifest(caseFile: CaseFile): HandoffManifest {
  const participants = safeListParticipants(caseFile);
  const handoffs = safeArray(caseFile.handoffRecords).map(cloneHandoff);
  const latestHandoff = handoffs.length > 0 ? handoffs[handoffs.length - 1] : undefined;
  const attachments = safeArray(caseFile.attachments).map(cloneAttachment);
  const openRisks = safeArray(caseFile.riskLog).filter((entry) => entry.status === 'open').map(cloneRisk);
  const pendingApprovals = safeArray(caseFile.approvals)
    .filter((entry) => entry.status === 'requested')
    .map(cloneApproval);
  const recentDecisions = pickRecentDecisions(safeArray(caseFile.decisionLog));
  const requiredAttachments = pickRequiredAttachments(attachments, latestHandoff);
  const currentOwner =
    safeParticipantDisplayName(caseFile, latestHandoff?.currentOwner) ?? caseFile.owner;
  const nextOwner =
    safeParticipantDisplayName(caseFile, latestHandoff?.nextOwner) ?? latestHandoff?.nextOwner ?? caseFile.owner;
  const recommendedActions = buildRecommendedActions(
    latestHandoff,
    requiredAttachments,
    openRisks,
    pendingApprovals,
    recentDecisions,
  );

  return {
    caseId: caseFile.id,
    generatedAt: now(),
    currentOwner,
    nextOwner,
    status: caseFile.status,
    summary: buildSummary(
      caseFile,
      currentOwner,
      nextOwner,
      openRisks,
      pendingApprovals,
      recentDecisions,
      requiredAttachments,
    ),
    participants,
    requiredAttachments,
    openRisks,
    pendingApprovals,
    recentDecisions,
    recommendedActions,
    handoffNotes: latestHandoff?.handoffNotes ?? 'No handoff notes recorded yet.',
    sourceCase: createSourceCase(caseFile, handoffs, openRisks, pendingApprovals, recentDecisions),
  };
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

function formatOptional(value?: string | null): string {
  return value && value.trim() ? value : 'None';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderParticipant(participant: Participant): string[] {
  return [
    `* ${participant.name}`,
    `  * id: ${participant.id}`,
    `  * type: ${titleCase(participant.type)}`,
    `  * role: ${titleCase(participant.role)}`,
  ];
}

function renderAttachment(attachment: CaseAttachment): string[] {
  const lines = [`* ${attachment.label}`];
  lines.push(`  * id: ${attachment.id}`);
  lines.push(`  * type: ${titleCase(attachment.type)}`);
  if (attachment.path) {
    lines.push(`  * path: ${attachment.path}`);
  }
  if (attachment.url) {
    lines.push(`  * url: ${attachment.url}`);
  }
  if (attachment.description) {
    lines.push(`  * description: ${attachment.description}`);
  }
  return lines;
}

function renderRisk(risk: CaseRiskEntry): string[] {
  return [
    `* ${risk.risk}`,
    `  * id: ${risk.id}`,
    `  * severity: ${risk.severity}`,
    `  * mitigation: ${risk.mitigation}`,
    `  * status: ${risk.status}`,
  ];
}

function renderApproval(approval: CaseApprovalRecord): string[] {
  return [
    `* ${approval.subject}`,
    `  * id: ${approval.id}`,
    `  * requested by: ${approval.requestedBy}`,
    `  * requested for: ${approval.requestedFor}`,
    `  * status: ${approval.status}`,
    `  * approver: ${formatOptional(approval.approver)}`,
    `  * note: ${formatOptional(approval.note)}`,
  ];
}

function renderDecision(decision: CaseDecisionEntry): string[] {
  return [
    `* ${decision.decision}`,
    `  * id: ${decision.id}`,
    `  * rationale: ${decision.rationale}`,
    `  * owner: ${formatOptional(decision.owner)}`,
  ];
}

function renderSourceCase(sourceCase: HandoffManifestSourceCase): string[] {
  return [
    `* caseId: ${sourceCase.id}`,
    `* goal: ${sourceCase.goal}`,
    `* owner: ${sourceCase.owner}`,
    `* project: ${sourceCase.project}`,
    `* status: ${sourceCase.status}`,
    `* createdAt: ${sourceCase.createdAt}`,
    `* updatedAt: ${sourceCase.updatedAt}`,
    `* closedAt: ${formatOptional(sourceCase.closedAt)}`,
    `* participantIds: ${formatList(sourceCase.participantIds)}`,
    `* attachmentIds: ${formatList(sourceCase.attachmentIds)}`,
    `* decisionIds: ${formatList(sourceCase.decisionIds)}`,
    `* openRiskIds: ${formatList(sourceCase.openRiskIds)}`,
    `* pendingApprovalIds: ${formatList(sourceCase.pendingApprovalIds)}`,
    `* handoffIds: ${formatList(sourceCase.handoffIds)}`,
    `* latestHandoffId: ${formatOptional(sourceCase.latestHandoffId)}`,
  ];
}

function cloneSourceCase(sourceCase: HandoffManifestSourceCase): HandoffManifestSourceCase {
  return {
    ...sourceCase,
    participantIds: [...sourceCase.participantIds],
    attachmentIds: [...sourceCase.attachmentIds],
    decisionIds: [...sourceCase.decisionIds],
    openRiskIds: [...sourceCase.openRiskIds],
    pendingApprovalIds: [...sourceCase.pendingApprovalIds],
    handoffIds: [...sourceCase.handoffIds],
  };
}

export function exportHandoffManifestJSON(manifest: HandoffManifest): HandoffManifest {
  return {
    ...manifest,
    participants: manifest.participants.map(cloneParticipant),
    requiredAttachments: manifest.requiredAttachments.map(cloneAttachment),
    openRisks: manifest.openRisks.map(cloneRisk),
    pendingApprovals: manifest.pendingApprovals.map(cloneApproval),
    recentDecisions: manifest.recentDecisions.map(cloneDecision),
    recommendedActions: [...manifest.recommendedActions],
    sourceCase: cloneSourceCase(manifest.sourceCase),
  };
}

export function exportHandoffManifestMarkdown(manifest: HandoffManifest): string {
  const lines: string[] = ['# Safeloop Handoff Manifest', ''];

  lines.push(`Case ID: ${manifest.caseId}`);
  lines.push(`Generated at: ${manifest.generatedAt}`);
  lines.push(`Status: ${manifest.status}`);
  lines.push('', '## Summary', '');
  lines.push(manifest.summary);
  lines.push('', '## Current Owner', '');
  lines.push(manifest.currentOwner || 'None');
  lines.push('', '## Next Owner', '');
  lines.push(manifest.nextOwner || 'None');
  lines.push('', '## Participants', '');
  if (manifest.participants.length === 0) {
    lines.push('None');
  } else {
    manifest.participants.forEach((participant) => {
      lines.push(...renderParticipant(participant));
      lines.push('');
    });
  }

  lines.push('', '## Required Attachments', '');
  if (manifest.requiredAttachments.length === 0) {
    lines.push('None');
  } else {
    manifest.requiredAttachments.forEach((attachment) => {
      lines.push(...renderAttachment(attachment));
      lines.push('');
    });
  }

  lines.push('', '## Open Risks', '');
  if (manifest.openRisks.length === 0) {
    lines.push('None');
  } else {
    manifest.openRisks.forEach((risk) => {
      lines.push(...renderRisk(risk));
      lines.push('');
    });
  }

  lines.push('', '## Pending Approvals', '');
  if (manifest.pendingApprovals.length === 0) {
    lines.push('None');
  } else {
    manifest.pendingApprovals.forEach((approval) => {
      lines.push(...renderApproval(approval));
      lines.push('');
    });
  }

  lines.push('', '## Recent Decisions', '');
  if (manifest.recentDecisions.length === 0) {
    lines.push('None');
  } else {
    manifest.recentDecisions.forEach((decision) => {
      lines.push(...renderDecision(decision));
      lines.push('');
    });
  }

  lines.push('', '## Recommended Actions', '');
  lines.push(manifest.recommendedActions.length > 0 ? formatList(manifest.recommendedActions) : 'None');
  lines.push('', '## Handoff Notes', '');
  lines.push(manifest.handoffNotes || 'None');
  lines.push('', '## Source Case', '');
  lines.push(...renderSourceCase(manifest.sourceCase));

  return lines.join('\n').trim();
}
