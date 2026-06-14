import {
  addCaseContext,
  addParticipant,
  attachArtifact,
  createCaseFile,
  exportHandoffManifestJSON,
  exportHandoffManifestMarkdown,
  generateHandoffManifest,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
} from '../src/index';

let caseFile = createCaseFile({
  goal: 'Prepare the next agent handoff',
  owner: 'Hermes',
  project: 'Safeloop',
});

caseFile = addParticipant(caseFile, {
  id: 'Hermes',
  name: 'Hermes',
  type: 'agent',
  role: 'owner',
});

caseFile = addParticipant(caseFile, {
  id: 'OpenCode',
  name: 'OpenCode',
  type: 'agent',
  role: 'implementer',
});

caseFile = addParticipant(caseFile, {
  id: 'Charles',
  name: 'Charles Zeller',
  type: 'human',
  role: 'approver',
});

caseFile = addCaseContext(caseFile, {
  contextUsed: 'Safeloop Case File and handoff layer',
  references: ['README.md', 'ROADMAP.md'],
  createdBy: 'Hermes',
});

caseFile = attachArtifact(caseFile, {
  type: 'document',
  label: 'Roadmap',
  path: './ROADMAP.md',
  description: 'Release roadmap for v0.4 and beyond',
});

caseFile = attachArtifact(caseFile, {
  type: 'report',
  label: 'Case Report',
  path: './SAFELOOP_CASE.md',
  description: 'Current accountability report',
});

caseFile = recordCaseDecision(caseFile, {
  decision: 'Add the first Handoff Manifest capability',
  rationale: 'Provide a compact summary for the next agent without creating packages yet',
  createdBy: 'OpenCode',
});

caseFile = recordCaseRisk(caseFile, {
  risk: 'Teams may expect full handoff packaging too early',
  severity: 'medium',
  mitigation: 'Keep v0.4 focused on the manifest only',
  createdBy: 'Hermes',
});

caseFile = requestCaseApproval(caseFile, {
  subject: 'Approve handoff manifest foundation',
  requestedBy: 'Hermes',
  requestedByParticipantId: 'Hermes',
  requestedFor: 'Charles Zeller',
  reason: 'Need approval before handing work to the next agent',
});

caseFile = recordHandoff(caseFile, {
  from: 'Hermes',
  to: 'OpenCode',
  fromParticipantId: 'Hermes',
  toParticipantId: 'OpenCode',
  handoffNotes: 'Continue from the roadmap, review the case report, and keep the layer additive.',
  recommendedNextActions: ['Review ROADMAP.md', 'Read the case report', 'Validate the manifest output'],
  attachmentIds: caseFile.attachments.map((attachment) => attachment.id),
});

const manifest = generateHandoffManifest(caseFile);

console.log(exportHandoffManifestMarkdown(manifest));
console.log('');
console.log(JSON.stringify(exportHandoffManifestJSON(manifest), null, 2));
