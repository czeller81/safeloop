import type {
  CaseApprovalRecord,
  CaseAttachment,
  CaseContextEntry,
  CaseDecisionEntry,
  CaseFile,
  CaseFileStatus,
  CaseHandoffRecord,
  CaseRiskEntry,
  Participant,
} from './caseTypes';

export type SafeloopReportQueryType =
  | 'safety-summary'
  | 'case-summary'
  | 'handoff-summary'
  | 'release-readiness'
  | 'governance-audit'
  | 'evidence-summary';

export interface SafeloopReportQuery {
  type: SafeloopReportQueryType;
  scope?: string;
  includeEvidence?: boolean;
  includeRisks?: boolean;
  includeApprovals?: boolean;
  includeAttachments?: boolean;
  includeParticipants?: boolean;
  includeHandoffs?: boolean;
}

export interface SafeloopQueryResult {
  queryType: SafeloopReportQueryType;
  generatedAt: string;
  caseId?: string;
  scope?: string;
  summary: string;
  checks: string[];
  passed: string[];
  failed: string[];
  risks: string[];
  approvals: string[];
  attachments: string[];
  participants: string[];
  handoffs: string[];
  evidence: string[];
  recommendations: string[];
  projectName?: string;
  policyName?: string;
  purpose?: string;
  filesChecked?: string[];
  directoriesChecked?: string[];
  guardrails?: string[];
  validationCommands?: string[];
  result?: 'PASS' | 'FAIL';
  notes?: string[];
}

export interface ProjectGuardrailReportInput {
  projectName: string;
  policyName: string;
  purpose: string;
  filesChecked: string[];
  directoriesChecked: string[];
  guardrails: string[];
  validationCommands: string[];
  result: 'PASS' | 'FAIL';
  notes?: string[];
}

export interface SafeloopCaseLike {
  id?: string;
  goal?: string;
  owner?: string;
  project?: string;
  status?: CaseFileStatus;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  participants?: string[];
  participantDirectory?: Participant[];
  contextTrail?: CaseContextEntry[];
  decisionLog?: CaseDecisionEntry[];
  riskLog?: CaseRiskEntry[];
  approvals?: CaseApprovalRecord[];
  handoffRecords?: CaseHandoffRecord[];
  attachments?: CaseAttachment[];
}

function now(): string {
  return new Date().toISOString();
}

function safeArray<T>(values?: T[] | null): T[] {
  return Array.isArray(values) ? values : [];
}

function trimText(value: unknown): string {
  return String(value ?? '').trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => trimText(value)).filter(Boolean)));
}

function bulletList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function caseLabel(caseFile: SafeloopCaseLike): string {
  const project = trimText(caseFile.project) || 'Case';
  const goal = trimText(caseFile.goal);
  return goal ? `${project}: ${goal}` : project;
}

function participantNames(caseFile: SafeloopCaseLike): string[] {
  const explicit = safeArray(caseFile.participantDirectory)
    .map((participant) => trimText(participant.name || participant.id))
    .filter(Boolean);
  const legacy = safeArray(caseFile.participants).map(trimText).filter(Boolean);
  return unique([...explicit, ...legacy]);
}

function formatContext(entry: CaseContextEntry): string {
  return `Context: ${entry.contextUsed}`;
}

function formatDecision(entry: CaseDecisionEntry): string {
  return `Decision: ${entry.decision}`;
}

function formatRisk(entry: CaseRiskEntry): string {
  const prefix = entry.status === 'open' ? 'Open risk' : entry.status === 'accepted' ? 'Accepted risk' : 'Mitigated risk';
  return `${prefix}: ${entry.risk}`;
}

function formatApproval(entry: CaseApprovalRecord): string {
  const actor = trimText(entry.approver || entry.requestedBy || 'Unknown');
  const subject = trimText(entry.subject);
  return subject ? `${titleCase(entry.status)} by ${actor}: ${subject}` : `${titleCase(entry.status)} by ${actor}`;
}

function formatAttachment(attachment: CaseAttachment): string {
  return `Attachment: ${attachment.label}`;
}

function formatHandoff(entry: CaseHandoffRecord): string {
  const from = trimText(entry.currentOwner || 'Unknown');
  const to = trimText(entry.nextOwner || 'Unknown');
  return `Handoff: ${from} → ${to}`;
}

function buildEvidenceFromCase(caseFile: SafeloopCaseLike, includeAll = true): string[] {
  const evidence: string[] = [];

  safeArray(caseFile.contextTrail).forEach((entry) => {
    evidence.push(formatContext(entry));
  });

  safeArray(caseFile.decisionLog).forEach((entry) => {
    evidence.push(formatDecision(entry));
  });

  safeArray(caseFile.attachments).forEach((attachment) => {
    if (includeAll || attachment.type === 'report' || attachment.type === 'document' || attachment.type === 'file') {
      evidence.push(formatAttachment(attachment));
    }
  });

  safeArray(caseFile.approvals).forEach((entry) => {
    evidence.push(`Approval: ${formatApproval(entry).replace(/^Approved by /, '').replace(/^Rejected by /, '').replace(/^Needs Changes by /, '')}`);
  });

  safeArray(caseFile.handoffRecords).forEach((entry) => {
    evidence.push(formatHandoff(entry));
  });

  return unique(evidence);
}

function buildRiskSummaries(caseFile: SafeloopCaseLike): string[] {
  return safeArray(caseFile.riskLog).map(formatRisk);
}

function buildApprovalSummaries(caseFile: SafeloopCaseLike): string[] {
  return safeArray(caseFile.approvals).map(formatApproval);
}

function buildAttachmentSummaries(caseFile: SafeloopCaseLike): string[] {
  return safeArray(caseFile.attachments).map(formatAttachment);
}

function buildHandoffSummaries(caseFile: SafeloopCaseLike): string[] {
  return safeArray(caseFile.handoffRecords).map(formatHandoff);
}

function addIfPresent(target: string[], condition: boolean, value: string): void {
  if (condition) {
    target.push(value);
  }
}

function buildSafetySummary(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const participantCount = participantNames(caseFile).length;
  const approvalCount = safeArray(caseFile.approvals).length;
  const handoffCount = safeArray(caseFile.handoffRecords).length;
  const summary = `Safety summary for ${caseLabel(caseFile)}: ${participantCount} participant${participantCount === 1 ? '' : 's'}, ${approvalCount} approval${approvalCount === 1 ? '' : 's'}, and ${handoffCount} handoff${handoffCount === 1 ? '' : 's'} recorded.`;

  const checks = [
    'Case file has participants recorded',
    'Case file has approval history',
    'Case file has handoff history',
  ];

  const passed: string[] = [];
  const failed: string[] = [];
  addIfPresent(passed, participantCount > 0, 'Participants are present');
  addIfPresent(passed, approvalCount > 0, 'Approval trail is present');
  addIfPresent(passed, handoffCount > 0, 'Handoff trail is present');

  addIfPresent(failed, participantCount === 0, 'No participants recorded');
  addIfPresent(failed, approvalCount === 0, 'No approvals recorded');
  addIfPresent(failed, handoffCount === 0, 'No handoffs recorded');

  const recommendations = failed.length > 0
    ? ['Record the missing accountability trail items before handoff']
    : ['Preserve the explicit case trail in the final report'];

  return { checks, passed, failed, recommendations, summary };
}

function buildCaseSummary(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const contexts = safeArray(caseFile.contextTrail).length;
  const decisions = safeArray(caseFile.decisionLog).length;
  const risks = safeArray(caseFile.riskLog).length;
  const approvals = safeArray(caseFile.approvals).length;
  const handoffs = safeArray(caseFile.handoffRecords).length;
  const attachments = safeArray(caseFile.attachments).length;

  return {
    summary: `Case summary for ${caseLabel(caseFile)} with ${contexts} context entr${contexts === 1 ? 'y' : 'ies'}, ${decisions} decision${decisions === 1 ? '' : 's'}, ${risks} risk${risks === 1 ? '' : 's'}, ${approvals} approval${approvals === 1 ? '' : 's'}, ${handoffs} handoff${handoffs === 1 ? '' : 's'}, and ${attachments} attachment${attachments === 1 ? '' : 's'}.`,
    checks: [
      `Context entries: ${contexts}`,
      `Decisions: ${decisions}`,
      `Risks: ${risks}`,
      `Approvals: ${approvals}`,
      `Handoffs: ${handoffs}`,
      `Attachments: ${attachments}`,
    ],
    passed: [],
    failed: [],
    recommendations: ['Use the handoff, evidence, and release queries for a fuller picture'],
  };
}

function buildHandoffSummary(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const handoffs = safeArray(caseFile.handoffRecords);
  const latest = handoffs[handoffs.length - 1];
  const currentOwner = trimText(latest?.currentOwner || caseFile.owner || 'Unknown');
  const nextOwner = trimText(latest?.nextOwner || 'Unknown');

  const summary = latest
    ? `Handoff summary for ${caseLabel(caseFile)} from ${currentOwner} to ${nextOwner}.`
    : `Handoff summary for ${caseLabel(caseFile)} with no recorded handoff yet.`;

  const checks = [
    latest ? 'Latest handoff recorded' : 'No handoff recorded yet',
    'Recommended next actions captured',
  ];

  const passed = latest
    ? ['Handoff trail is present', `Current owner is ${currentOwner}`, `Next owner is ${nextOwner}`]
    : [];

  const failed = latest ? [] : ['No handoff trail recorded'];

  const recommendations = latest
    ? [...latest.recommendedNextActions, 'Preserve the handoff trail in the final report']
    : ['Record a handoff before passing the case to the next owner'];

  return { summary, checks, passed, failed, recommendations };
}

function buildReleaseReadiness(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const openRisks = safeArray(caseFile.riskLog).filter((risk) => risk.status === 'open');
  const approvals = safeArray(caseFile.approvals);
  const attachments = safeArray(caseFile.attachments);
  const handoffs = safeArray(caseFile.handoffRecords);
  const latestApproval = approvals[approvals.length - 1];
  const latestHandoff = handoffs[handoffs.length - 1];
  const ready = openRisks.length === 0 && latestApproval?.status === 'approved';

  const checks = [
    `Open risks: ${openRisks.length}`,
    `Latest approval status: ${latestApproval?.status ?? 'none'}`,
    `Attachments: ${attachments.length}`,
    `Handoffs: ${handoffs.length}`,
  ];

  const passed: string[] = [];
  const failed: string[] = [];

  addIfPresent(passed, openRisks.length === 0, 'No open risks remain');
  addIfPresent(failed, openRisks.length > 0, `Open risks remain: ${openRisks.length}`);

  addIfPresent(passed, latestApproval?.status === 'approved', 'Approval is approved');
  addIfPresent(failed, latestApproval?.status !== 'approved', 'Approval is not approved');

  addIfPresent(passed, attachments.length > 0, 'Attachments are present');
  addIfPresent(failed, attachments.length === 0, 'No attachments are present');

  addIfPresent(passed, Boolean(latestHandoff), 'Handoff trail is present');
  addIfPresent(failed, !latestHandoff, 'No handoff trail is present');

  const recommendations = failed.length > 0
    ? ['Resolve open risks before release', 'Confirm approvals before handoff']
    : ['Proceed with handoff or release'];

  return {
    summary: ready
      ? `Case ${caseLabel(caseFile)} is release ready.`
      : `Case ${caseLabel(caseFile)} is not release ready.`,
    checks,
    passed,
    failed,
    recommendations,
  };
}

function buildGovernanceAudit(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const participants = participantNames(caseFile);
  const approvals = safeArray(caseFile.approvals);
  const handoffs = safeArray(caseFile.handoffRecords);
  const evidenceCount =
    safeArray(caseFile.contextTrail).length +
    safeArray(caseFile.decisionLog).length +
    safeArray(caseFile.attachments).length +
    approvals.length +
    handoffs.length;

  return {
    summary: `Governance audit for ${caseLabel(caseFile)} with ${participants.length} participant${participants.length === 1 ? '' : 's'} and ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}.`,
    checks: [
      `Participants: ${participants.length}`,
      `Approvals: ${approvals.length}`,
      `Handoffs: ${handoffs.length}`,
      `Evidence items: ${evidenceCount}`,
    ],
    passed: [
      participants.length > 0 ? 'Participants are present' : 'Participants are missing',
      approvals.length > 0 ? 'Approval trail is present' : 'Approval trail is missing',
      handoffs.length > 0 ? 'Handoff trail is present' : 'Handoff trail is missing',
    ].filter((value) => !value.endsWith('missing')),
    failed: [
      participants.length === 0 ? 'Participants are missing' : '',
      approvals.length === 0 ? 'Approval trail is missing' : '',
      handoffs.length === 0 ? 'Handoff trail is missing' : '',
    ].filter(Boolean),
    recommendations: ['Keep the Case File explicit, local, and reviewable'],
  };
}

function buildEvidenceSummary(caseFile: SafeloopCaseLike): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const contexts = safeArray(caseFile.contextTrail);
  const decisions = safeArray(caseFile.decisionLog);
  const attachments = safeArray(caseFile.attachments);
  const approvals = safeArray(caseFile.approvals);
  const handoffs = safeArray(caseFile.handoffRecords);

  const summary = `Evidence summary for ${caseLabel(caseFile)} with ${contexts.length} context entr${contexts.length === 1 ? 'y' : 'ies'}, ${decisions.length} decision${decisions.length === 1 ? '' : 's'}, ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}, ${approvals.length} approval${approvals.length === 1 ? '' : 's'}, and ${handoffs.length} handoff${handoffs.length === 1 ? '' : 's'}.`;

  return {
    summary,
    checks: [
      'Context trail captured',
      'Decision trail captured',
      'Attachment trail captured',
      'Approval trail captured',
      'Handoff trail captured',
    ],
    passed: [
      contexts.length > 0 ? 'Context trail is present' : '',
      decisions.length > 0 ? 'Decision trail is present' : '',
      attachments.length > 0 ? 'Attachment trail is present' : '',
      approvals.length > 0 ? 'Approval trail is present' : '',
      handoffs.length > 0 ? 'Handoff trail is present' : '',
    ].filter(Boolean),
    failed: [],
    recommendations: ['Keep the evidence trail attached to the final handoff'],
  };
}

function normalizeReadinessResult(result: 'PASS' | 'FAIL'): 'PASS' | 'FAIL' {
  return result === 'PASS' ? 'PASS' : 'FAIL';
}

function summarizeProjectGuardrailReport(input: ProjectGuardrailReportInput): Pick<
  SafeloopQueryResult,
  'checks' | 'passed' | 'failed' | 'recommendations' | 'summary'
> {
  const filesChecked = unique(input.filesChecked);
  const directoriesChecked = unique(input.directoriesChecked);
  const guardrails = unique(input.guardrails);
  const validationCommands = unique(input.validationCommands);
  const passed = [
    filesChecked.length > 0 ? 'Required files were listed explicitly' : '',
    directoriesChecked.length > 0 ? 'Required directories were listed explicitly' : '',
    guardrails.length > 0 ? 'Guardrails were listed explicitly' : '',
    validationCommands.length > 0 ? 'Validation commands were listed explicitly' : '',
    normalizeReadinessResult(input.result) === 'PASS' ? 'Validation completed with PASS' : '',
  ].filter(Boolean);
  const failed = normalizeReadinessResult(input.result) === 'FAIL'
    ? ['Validation reported FAIL']
    : [];

  return {
    summary: `${input.projectName} project guardrail report for ${input.policyName} (${input.result}).`,
    checks: [
      `Files checked: ${filesChecked.length}`,
      `Directories checked: ${directoriesChecked.length}`,
      `Guardrails: ${guardrails.length}`,
      `Validation commands: ${validationCommands.length}`,
    ],
    passed,
    failed,
    recommendations:
      input.result === 'PASS'
        ? ['Preserve this guardrail report in the final handoff']
        : ['Review the failing checks before release'],
  };
}

export function querySafeloop(
  caseFile: SafeloopCaseLike,
  query: SafeloopReportQuery,
): SafeloopQueryResult {
  const base =
    query.type === 'safety-summary'
      ? buildSafetySummary(caseFile)
      : query.type === 'case-summary'
      ? buildCaseSummary(caseFile)
      : query.type === 'handoff-summary'
      ? buildHandoffSummary(caseFile)
      : query.type === 'release-readiness'
      ? buildReleaseReadiness(caseFile)
      : query.type === 'governance-audit'
      ? buildGovernanceAudit(caseFile)
      : buildEvidenceSummary(caseFile);

  const participants = query.includeParticipants ? participantNames(caseFile) : [];
  const risks = query.includeRisks ? buildRiskSummaries(caseFile) : [];
  const approvals = query.includeApprovals ? buildApprovalSummaries(caseFile) : [];
  const attachments = query.includeAttachments ? buildAttachmentSummaries(caseFile) : [];
  const handoffs = query.includeHandoffs ? buildHandoffSummaries(caseFile) : [];
  const evidence = query.includeEvidence ? buildEvidenceFromCase(caseFile) : [];

  return {
    queryType: query.type,
    generatedAt: now(),
    caseId: caseFile.id,
    scope: query.scope,
    summary: base.summary,
    checks: base.checks,
    passed: base.passed,
    failed: base.failed,
    risks,
    approvals,
    attachments,
    participants,
    handoffs,
    evidence,
    recommendations: base.recommendations,
  };
}

export function createProjectGuardrailReport(
  input: ProjectGuardrailReportInput,
): SafeloopQueryResult {
  const filesChecked = unique(input.filesChecked);
  const directoriesChecked = unique(input.directoriesChecked);
  const guardrails = unique(input.guardrails);
  const validationCommands = unique(input.validationCommands);
  const base = summarizeProjectGuardrailReport({
    ...input,
    filesChecked,
    directoriesChecked,
    guardrails,
    validationCommands,
  });

  return {
    queryType: 'governance-audit',
    generatedAt: now(),
    scope: input.projectName,
    summary: base.summary,
    checks: base.checks,
    passed: base.passed,
    failed: base.failed,
    risks: guardrails.map((guardrail) => `Guardrail: ${guardrail}`),
    approvals: [],
    attachments: [],
    participants: [],
    handoffs: [],
    evidence: [
      `Files checked: ${filesChecked.join(', ')}`,
      `Directories checked: ${directoriesChecked.join(', ')}`,
      `Guardrails: ${guardrails.join(', ')}`,
      `Validation commands: ${validationCommands.join(', ')}`,
      `Result: ${input.result}`,
      ...(input.notes ?? []).map((note) => `Note: ${note}`),
    ],
    recommendations: base.recommendations,
    projectName: input.projectName,
    policyName: input.policyName,
    purpose: input.purpose,
    filesChecked,
    directoriesChecked,
    guardrails,
    validationCommands,
    result: input.result,
    notes: input.notes ? unique(input.notes) : [],
  };
}

function renderSection(lines: string[], title: string, values: string[]): void {
  lines.push('', `## ${title}`, '');
  lines.push(values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None');
}

export function exportSafeloopQueryMarkdown(result: SafeloopQueryResult): string {
  const lines: string[] = ['# Safeloop Query Report', ''];

  lines.push('## Query Type', '', result.queryType);
  if (result.projectName) {
    lines.push('', '## Project', '', result.projectName);
  }
  if (result.policyName) {
    lines.push('', '## Policy', '', result.policyName);
  }
  if (result.purpose) {
    lines.push('', '## Purpose', '', result.purpose);
  }
  if (result.caseId) {
    lines.push('', '## Case ID', '', result.caseId);
  }
  if (result.scope) {
    lines.push('', '## Scope', '', result.scope);
  }

  lines.push('', '## Summary', '', result.summary || 'None');

  renderSection(lines, 'Checks', result.checks);
  renderSection(lines, 'Passed', result.passed);
  renderSection(lines, 'Failed', result.failed);
  renderSection(lines, 'Risks', result.risks);
  renderSection(lines, 'Approvals', result.approvals);
  renderSection(lines, 'Attachments', result.attachments);
  renderSection(lines, 'Participants', result.participants);
  renderSection(lines, 'Handoffs', result.handoffs);
  renderSection(lines, 'Evidence', result.evidence);
  renderSection(lines, 'Recommendations', result.recommendations);

  if (result.filesChecked) {
    renderSection(lines, 'Files Checked', result.filesChecked);
  }
  if (result.directoriesChecked) {
    renderSection(lines, 'Directories Checked', result.directoriesChecked);
  }
  if (result.guardrails) {
    renderSection(lines, 'Guardrails', result.guardrails);
  }
  if (result.validationCommands) {
    renderSection(lines, 'Validation Commands', result.validationCommands);
  }
  if (result.notes) {
    renderSection(lines, 'Notes', result.notes);
  }
  if (result.result) {
    lines.push('', '## Result', '', result.result);
  }

  return lines.join('\n').trim();
}

export function exportSafeloopQueryJSON(result: SafeloopQueryResult): SafeloopQueryResult {
  return JSON.parse(JSON.stringify(result)) as SafeloopQueryResult;
}
