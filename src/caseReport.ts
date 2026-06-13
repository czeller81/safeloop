import type {
  CaseApprovalStatus,
  CaseAttachment,
  CaseFile,
  CaseReportJSON,
  CaseReportMarkdownOptions,
  Participant,
} from './caseTypes';
import { getParticipant, listParticipants } from './caseFile';

function formatList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

function formatOptional(value?: string | null): string {
  return value && value.trim() ? value : 'None';
}

function summarizeApprovalStatus(caseFile: CaseFile): CaseApprovalStatus | 'none' {
  const latest = caseFile.approvals[caseFile.approvals.length - 1];
  return latest?.status ?? 'none';
}

function cloneAttachment(entry: CaseAttachment): CaseAttachment {
  return {
    ...entry,
    metadata: entry.metadata ? { ...entry.metadata } : undefined,
  };
}

function cloneParticipant(participant: Participant): Participant {
  return { ...participant };
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getDisplayParticipantName(caseFile: CaseFile, participantId?: string | null): string | null {
  if (!participantId) {
    return null;
  }
  return getParticipant(caseFile, participantId)?.name ?? participantId;
}

function renderParticipantBullet(participant: Participant): string[] {
  return [
    `* ${participant.name}`,
    `  * type: ${participant.type}`,
    `  * role: ${participant.role}`,
  ];
}

function renderParticipantSummaryTable(participants: Participant[]): string[] {
  const lines = ['| Participant | Type | Role |', '| --- | --- | --- |'];
  participants.forEach((participant) => {
    lines.push(
      `| ${participant.name} | ${titleCase(participant.type)} | ${titleCase(participant.role)} |`,
    );
  });
  return lines;
}

function renderAttributionLine(label: string, participantName?: string | null): string[] {
  if (!participantName) {
    return [];
  }
  return [`${label}: ${participantName}`];
}

export function exportCaseReportJSON(caseFile: CaseFile): CaseReportJSON {
  return {
    generatedAt: new Date().toISOString(),
    caseFile: {
      ...caseFile,
      participants: [...caseFile.participants],
      participantDirectory: caseFile.participantDirectory
        ? caseFile.participantDirectory.map(cloneParticipant)
        : undefined,
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
    },
    summary: {
      contextEntries: caseFile.contextTrail.length,
      decisions: caseFile.decisionLog.length,
      risks: caseFile.riskLog.length,
      approvals: caseFile.approvals.length,
      handoffs: caseFile.handoffRecords.length,
      attachments: caseFile.attachments.length,
      lastApprovalStatus: summarizeApprovalStatus(caseFile),
    },
  };
}

function formatAttachmentLine(prefix: string, value?: string): string {
  return value ? `${prefix}: ${value}` : `${prefix}: None`;
}

function renderAttachment(attachment: CaseAttachment): string[] {
  const lines = [`* ${attachment.label}`];
  lines.push(`  * type: ${attachment.type}`);
  if (attachment.path) {
    lines.push(`  * path: ${attachment.path}`);
  }
  if (attachment.url) {
    lines.push(`  * url: ${attachment.url}`);
  }
  if (attachment.description) {
    lines.push(`  * description: ${attachment.description}`);
  }
  if (attachment.metadata && Object.keys(attachment.metadata).length > 0) {
    lines.push(`  * metadata: ${JSON.stringify(attachment.metadata)}`);
  }
  return lines;
}

export function exportCaseReportMarkdown(
  caseFile: CaseFile,
  options: CaseReportMarkdownOptions = {},
): string {
  const lines: string[] = ['# Case Report', ''];

  lines.push(`Case ID: ${caseFile.id}`);
  lines.push(`Goal: ${caseFile.goal}`);
  lines.push(`Project: ${caseFile.project}`);
  lines.push(`Owner: ${caseFile.owner}`);
  lines.push(`Status: ${caseFile.status}`);
  lines.push(`Created at: ${caseFile.createdAt}`);
  lines.push(`Updated at: ${caseFile.updatedAt}`);
  lines.push(`Closed at: ${formatOptional(caseFile.closedAt)}`);

  const participants = listParticipants(caseFile);

  lines.push('', '## Participants', '');
  if (participants.length === 0) {
    lines.push('None');
  } else {
    participants.forEach((participant) => {
      lines.push(...renderParticipantBullet(participant));
      lines.push('');
    });
  }

  lines.push('', '## Participants Summary', '');
  if (participants.length === 0) {
    lines.push('None');
  } else {
    lines.push(...renderParticipantSummaryTable(participants));
  }

  lines.push('', '## Context Trail', '');
  if (caseFile.contextTrail.length === 0 && !options.includeEmptySections) {
    lines.push('None');
  } else {
    caseFile.contextTrail.forEach((entry, index) => {
      lines.push(`### Context ${index + 1}`);
      lines.push(`Context used: ${entry.contextUsed}`);
      lines.push(...renderAttributionLine('By', getDisplayParticipantName(caseFile, entry.createdBy)));
      lines.push(`References: ${formatList(entry.references)}`);
      lines.push(`Notes: ${formatList(entry.notes)}`);
      lines.push('');
    });
    if (caseFile.contextTrail.length === 0) {
      lines.push('None');
    }
  }

  lines.push('', '## Decision Log', '');
  if (caseFile.decisionLog.length === 0) {
    lines.push('None');
  } else {
    caseFile.decisionLog.forEach((entry, index) => {
      lines.push(`### Decision ${index + 1}`);
      lines.push(`Decision: ${entry.decision}`);
      lines.push(`Rationale: ${entry.rationale}`);
      lines.push(...renderAttributionLine('By', getDisplayParticipantName(caseFile, entry.createdBy)));
      lines.push(`Owner: ${formatOptional(entry.owner ?? null)}`);
      lines.push(`Related context IDs: ${formatList(entry.relatedContextIds)}`);
      lines.push('');
    });
  }

  lines.push('', '## Risk Tracking', '');
  if (caseFile.riskLog.length === 0) {
    lines.push('None');
  } else {
    caseFile.riskLog.forEach((entry, index) => {
      lines.push(`### Risk ${index + 1}`);
      lines.push(`Risk: ${entry.risk}`);
      lines.push(...renderAttributionLine('By', getDisplayParticipantName(caseFile, entry.createdBy)));
      lines.push(`Severity: ${entry.severity}`);
      lines.push(`Mitigation: ${entry.mitigation}`);
      lines.push(`Status: ${entry.status}`);
      lines.push('');
    });
  }

  lines.push('', '## Approvals', '');
  if (caseFile.approvals.length === 0) {
    lines.push('None');
  } else {
    caseFile.approvals.forEach((entry, index) => {
      lines.push(`### Approval ${index + 1}`);
      lines.push(`Subject: ${entry.subject}`);
      lines.push(`Requested by: ${formatOptional(getDisplayParticipantName(caseFile, entry.requestedByParticipantId) ?? entry.requestedBy)}`);
      lines.push(`Requested for: ${entry.requestedFor}`);
      lines.push(`Reason: ${formatOptional(entry.reason)}`);
      lines.push(`Status: ${entry.status}`);
      lines.push(`By: ${formatOptional(getDisplayParticipantName(caseFile, entry.resolvedByParticipantId) ?? entry.approver)}`);
      lines.push(`Note: ${formatOptional(entry.note)}`);
      lines.push(`References: ${formatList(entry.references)}`);
      lines.push('');
    });
  }

  lines.push('', '## Handoff Records', '');
  if (caseFile.handoffRecords.length === 0) {
    lines.push('None');
  } else {
    caseFile.handoffRecords.forEach((entry, index) => {
      lines.push(`### Handoff ${index + 1}`);
      lines.push(`Current owner: ${formatOptional(getDisplayParticipantName(caseFile, entry.fromParticipantId) ?? entry.currentOwner)}`);
      lines.push(`Next owner: ${formatOptional(getDisplayParticipantName(caseFile, entry.toParticipantId) ?? entry.nextOwner)}`);
      lines.push(`Handoff notes: ${entry.handoffNotes}`);
      lines.push(`Recommended next actions: ${formatList(entry.recommendedNextActions)}`);
      lines.push(`References: ${formatList(entry.references)}`);
      lines.push(`Attachment IDs: ${formatList(entry.attachmentIds)}`);
      lines.push('');
    });
  }

  lines.push('', '## Attachments', '');
  if (caseFile.attachments.length === 0) {
    lines.push('None');
  } else {
    caseFile.attachments.forEach((attachment) => {
      lines.push(...renderAttachment(attachment));
      lines.push('');
    });
  }

  lines.push('', '## Summary', '');
  lines.push(`Context entries: ${caseFile.contextTrail.length}`);
  lines.push(`Decisions: ${caseFile.decisionLog.length}`);
  lines.push(`Risks: ${caseFile.riskLog.length}`);
  lines.push(`Approvals: ${caseFile.approvals.length}`);
  lines.push(`Handoffs: ${caseFile.handoffRecords.length}`);
  lines.push(`Attachments: ${caseFile.attachments.length}`);

  return lines.join('\n').trim();
}
