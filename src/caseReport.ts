import type {
  CaseFile,
  CaseReportJSON,
  CaseReportMarkdownOptions,
  CaseApprovalStatus,
} from './caseTypes';

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

export function exportCaseReportJSON(caseFile: CaseFile): CaseReportJSON {
  return {
    generatedAt: new Date().toISOString(),
    caseFile: {
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
    },
    summary: {
      contextEntries: caseFile.contextTrail.length,
      decisions: caseFile.decisionLog.length,
      risks: caseFile.riskLog.length,
      approvals: caseFile.approvals.length,
      handoffs: caseFile.handoffRecords.length,
      lastApprovalStatus: summarizeApprovalStatus(caseFile),
    },
  };
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

  lines.push('', '## Participants', '');
  lines.push(formatList(caseFile.participants));

  lines.push('', '## Context Trail', '');
  if (caseFile.contextTrail.length === 0 && !options.includeEmptySections) {
    lines.push('None');
  } else {
    caseFile.contextTrail.forEach((entry, index) => {
      lines.push(`### Context ${index + 1}`);
      lines.push(`Context used: ${entry.contextUsed}`);
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
      lines.push(`Requested by: ${entry.requestedBy}`);
      lines.push(`Requested for: ${entry.requestedFor}`);
      lines.push(`Reason: ${formatOptional(entry.reason)}`);
      lines.push(`Status: ${entry.status}`);
      lines.push(`Approver: ${formatOptional(entry.approver)}`);
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
      lines.push(`Current owner: ${entry.currentOwner}`);
      lines.push(`Next owner: ${entry.nextOwner}`);
      lines.push(`Handoff notes: ${entry.handoffNotes}`);
      lines.push(`Recommended next actions: ${formatList(entry.recommendedNextActions)}`);
      lines.push(`References: ${formatList(entry.references)}`);
      lines.push('');
    });
  }

  lines.push('', '## Summary', '');
  lines.push(`Context entries: ${caseFile.contextTrail.length}`);
  lines.push(`Decisions: ${caseFile.decisionLog.length}`);
  lines.push(`Risks: ${caseFile.riskLog.length}`);
  lines.push(`Approvals: ${caseFile.approvals.length}`);
  lines.push(`Handoffs: ${caseFile.handoffRecords.length}`);

  return lines.join('\n').trim();
}
