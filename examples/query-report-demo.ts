import {
  addCaseContext,
  addParticipant,
  attachArtifact,
  createCaseFile,
  createProjectGuardrailReport,
  exportSafeloopQueryJSON,
  exportSafeloopQueryMarkdown,
  querySafeloop,
  recordCaseDecision,
  recordCaseRisk,
  recordHandoff,
  requestCaseApproval,
  resolveCaseApproval,
} from '../src/index';

function main(): void {
  let caseFile = createCaseFile({
    goal: 'Demonstrate the Safeloop report query layer',
    owner: 'Hermes',
    project: 'Safeloop',
  });

  caseFile = addParticipant(caseFile, {
    id: 'OpenCode',
    name: 'OpenCode',
    type: 'agent',
    role: 'implementer',
  });

  caseFile = addParticipant(caseFile, {
    id: 'Charles',
    name: 'Charles',
    type: 'human',
    role: 'approver',
  });

  caseFile = addCaseContext(caseFile, {
    contextUsed: 'PLOTS dogfooding run and local Safeloop boundary checks',
    references: ['README.md', 'docs/ARCHITECTURE.md'],
    notes: ['Keep reports local and explicit'],
    createdBy: 'Hermes',
  });

  caseFile = recordCaseDecision(caseFile, {
    decision: 'Add a structured reports query layer',
    rationale: 'Need a clean way to ask what happened after a run',
    relatedContextIds: [caseFile.contextTrail[0].id],
    createdBy: 'OpenCode',
  });

  caseFile = recordCaseRisk(caseFile, {
    risk: 'Reports could accidentally drift into telemetry',
    severity: 'medium',
    mitigation: 'Require explicit local inputs and no background collectors',
    createdBy: 'Hermes',
  });

  caseFile = attachArtifact(caseFile, {
    type: 'report',
    label: 'PLOTS Safeloop handoff notes',
    description: 'Local evidence from the dogfooding run',
  });

  caseFile = requestCaseApproval(caseFile, {
    subject: 'Approve the query layer',
    requestedBy: 'Hermes',
    requestedByParticipantId: 'Hermes',
    requestedFor: 'Charles',
    reason: 'Need approval before publishing the new report helper',
  });

  caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
    status: 'approved',
    approver: 'Charles',
    resolvedByParticipantId: 'Charles',
    note: 'Approved for local use',
  });

  caseFile = recordHandoff(caseFile, {
    from: 'Hermes',
    to: 'OpenCode',
    fromParticipantId: 'Hermes',
    toParticipantId: 'OpenCode',
    handoffNotes: 'Continue from the approved report layer and keep the trail explicit.',
    recommendedNextActions: ['Review the query API', 'Preserve the local-only contract'],
    attachmentIds: [caseFile.attachments[0].id],
  });

  const safetySummary = querySafeloop(caseFile, {
    type: 'safety-summary',
    includeEvidence: true,
    includeRisks: true,
    includeApprovals: true,
    includeAttachments: true,
    includeParticipants: true,
    includeHandoffs: true,
  });

  const releaseReadiness = querySafeloop(caseFile, {
    type: 'release-readiness',
    includeEvidence: true,
    includeRisks: true,
    includeApprovals: true,
    includeAttachments: true,
  });

  const evidenceSummary = querySafeloop(caseFile, {
    type: 'evidence-summary',
    includeEvidence: true,
    includeParticipants: true,
    includeAttachments: true,
    includeHandoffs: true,
  });

  const projectGuardrailReport = createProjectGuardrailReport({
    projectName: 'PLOTS',
    policyName: 'plots-safeloop-policy',
    purpose: 'decision-simulation and perspective-reflection tool',
    filesChecked: [
      'README.md',
      'docs/PRODUCT_BLUEPRINT.md',
      'docs/ARCHITECTURE.md',
      'prompts/hermes-bootstrap.md',
      'prompts/opencode-implementation.md',
    ],
    directoriesChecked: ['agents', 'docs', 'prompts'],
    guardrails: [
      'no diagnosis',
      'no therapy claims',
      'no medical/legal/financial advice',
      'no prediction certainty',
      'user remains decision-maker',
    ],
    validationCommands: [
      'npm run safeloop',
      'npm run check',
      'npm run build',
      'npx tsc --noEmit',
      'npm run demo',
    ],
    result: 'PASS',
    notes: ['Generated from explicit local project inputs only.'],
  });

  console.log('=== Safety Summary ===');
  console.log(exportSafeloopQueryMarkdown(safetySummary));
  console.log('\n=== Release Readiness (JSON) ===');
  console.log(JSON.stringify(exportSafeloopQueryJSON(releaseReadiness), null, 2));
  console.log('\n=== Evidence Summary ===');
  console.log(exportSafeloopQueryMarkdown(evidenceSummary));
  console.log('\n=== PLOTS Guardrail Report ===');
  console.log(exportSafeloopQueryMarkdown(projectGuardrailReport));
}

main();
