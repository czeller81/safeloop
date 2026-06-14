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

describe('Safeloop report query layer', () => {
  function buildCaseFile() {
    let caseFile = createCaseFile({
      goal: 'Add a report query layer',
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
      contextUsed: 'Real-world PLOTS dogfooding test',
      references: ['README.md', 'docs/ARCHITECTURE.md'],
      notes: ['Safeloop should stay local and explicit'],
      createdBy: 'Hermes',
    });

    caseFile = recordCaseDecision(caseFile, {
      decision: 'Add a local query/report API',
      rationale: 'Need a structured way to ask what happened after a run',
      relatedContextIds: [caseFile.contextTrail[0].id],
      createdBy: 'OpenCode',
    });

    caseFile = recordCaseRisk(caseFile, {
      risk: 'Query reports drift into telemetry or hidden capture',
      severity: 'medium',
      mitigation: 'Keep all inputs explicit and local-only',
      status: 'open',
      createdBy: 'Hermes',
    });

    caseFile = attachArtifact(caseFile, {
      type: 'report',
      label: 'PLOTS Safeloop handoff notes',
      description: 'Local evidence package from the dogfooding test',
      metadata: { project: 'PLOTS' },
    });

    caseFile = requestCaseApproval(caseFile, {
      subject: 'Approve the query layer design',
      requestedBy: 'Hermes',
      requestedFor: 'Charles',
      reason: 'Need approval before exposing query exports',
      references: ['README.md'],
      requestedByParticipantId: 'Hermes',
    });

    caseFile = resolveCaseApproval(caseFile, caseFile.approvals[0].id, {
      status: 'approved',
      approver: 'Charles',
      note: 'Approved for local query/report use',
      resolvedByParticipantId: 'Charles',
    });

    caseFile = recordHandoff(caseFile, {
      currentOwner: 'Hermes',
      nextOwner: 'OpenCode',
      handoffNotes: 'Continue from the approved query design and preserve local-only behavior.',
      recommendedNextActions: ['Implement querySafeloop()', 'Add markdown export'],
      references: ['README.md', 'docs/ARCHITECTURE.md'],
      attachmentIds: [caseFile.attachments[0].id],
      fromParticipantId: 'Hermes',
      toParticipantId: 'OpenCode',
    });

    return caseFile;
  }

  it('summarizes safety, evidence, and readiness signals', () => {
    const caseFile = buildCaseFile();

    const report = querySafeloop(caseFile, {
      type: 'safety-summary',
      includeEvidence: true,
      includeRisks: true,
      includeApprovals: true,
      includeAttachments: true,
      includeParticipants: true,
      includeHandoffs: true,
    });

    expect(report.queryType).toBe('safety-summary');
    expect(report.caseId).toBe(caseFile.id);
    expect(report.summary).toContain('report query layer');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        'Case file has participants recorded',
        'Case file has approval history',
        'Case file has handoff history',
      ]),
    );
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Participants are present',
        'Approval trail is present',
        'Handoff trail is present',
      ]),
    );
    expect(report.risks).toEqual(
      expect.arrayContaining(['Open risk: Query reports drift into telemetry or hidden capture']),
    );
    expect(report.approvals).toEqual(
      expect.arrayContaining(['Approved by Charles: Approve the query layer design']),
    );
    expect(report.attachments).toEqual(
      expect.arrayContaining(['Attachment: PLOTS Safeloop handoff notes']),
    );
    expect(report.participants).toEqual(
      expect.arrayContaining(['Hermes', 'OpenCode', 'Charles']),
    );
    expect(report.handoffs).toEqual(
      expect.arrayContaining(['Handoff: Hermes → OpenCode']),
    );
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        'Context: Real-world PLOTS dogfooding test',
        'Decision: Add a local query/report API',
        'Attachment: PLOTS Safeloop handoff notes',
        'Handoff: Hermes → OpenCode',
      ]),
    );
  });

  it('reports release readiness blockers when risks remain open', () => {
    const caseFile = buildCaseFile();

    const report = querySafeloop(caseFile, {
      type: 'release-readiness',
      includeRisks: true,
      includeApprovals: true,
      includeAttachments: true,
      includeEvidence: true,
    });

    expect(report.queryType).toBe('release-readiness');
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Approval is approved',
        'Attachments are present',
      ]),
    );
    expect(report.failed).toEqual(
      expect.arrayContaining(['Open risks remain: 1']),
    );
    expect(report.risks).toEqual(
      expect.arrayContaining(['Open risk: Query reports drift into telemetry or hidden capture']),
    );
    expect(report.recommendations).toEqual(
      expect.arrayContaining(['Resolve open risks before release']),
    );
    expect(report.summary).toContain('not release ready');
  });

  it('exports query reports to markdown and JSON', () => {
    const caseFile = buildCaseFile();
    const report = querySafeloop(caseFile, {
      type: 'evidence-summary',
      includeEvidence: true,
      includeParticipants: true,
      includeAttachments: true,
      includeHandoffs: true,
    });

    const markdown = exportSafeloopQueryMarkdown(report);
    const json = exportSafeloopQueryJSON(report);

    expect(markdown).toContain('# Safeloop Query Report');
    expect(markdown).toContain('## Query Type');
    expect(markdown).toContain('## Evidence');
    expect(markdown).toContain('Hermes → OpenCode');
    expect(markdown).toContain('PLOTS Safeloop handoff notes');
    expect(json.queryType).toBe('evidence-summary');
    expect(json.evidence).toEqual(expect.arrayContaining(['Handoff: Hermes → OpenCode']));
  });

  it('creates a PLOTS-style project guardrail report', () => {
    const report = createProjectGuardrailReport({
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
      notes: ['Local-only guardrail report generated from explicit project inputs.'],
    });

    const markdown = exportSafeloopQueryMarkdown(report);
    const json = exportSafeloopQueryJSON(report);

    expect(report.queryType).toBe('governance-audit');
    expect(report.projectName).toBe('PLOTS');
    expect(report.passed).toEqual(
      expect.arrayContaining([
        'Required files were listed explicitly',
        'Required directories were listed explicitly',
        'Validation completed with PASS',
      ]),
    );
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        'Files checked: README.md, docs/PRODUCT_BLUEPRINT.md, docs/ARCHITECTURE.md, prompts/hermes-bootstrap.md, prompts/opencode-implementation.md',
        'Directories checked: agents, docs, prompts',
      ]),
    );
    expect(markdown).toContain('## Project');
    expect(markdown).toContain('PLOTS');
    expect(markdown).toContain('## Policy');
    expect(markdown).toContain('plots-safeloop-policy');
    expect(markdown).toContain('Validation Commands');
    expect(markdown).toContain('## Result');
    expect(markdown).toContain('PASS');
    expect(json.projectName).toBe('PLOTS');
    expect(json.validationCommands).toEqual(expect.arrayContaining(['npm run safeloop']));
  });

  it('handles a minimal case file without optional arrays', () => {
    const minimalCase = {
      id: 'case-minimal',
      goal: 'Minimal compatibility',
      owner: 'Hermes',
      project: 'Safeloop',
      status: 'open',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      closedAt: null,
    } as any;

    const report = querySafeloop(minimalCase, {
      type: 'case-summary',
    });

    expect(report.caseId).toBe('case-minimal');
    expect(report.summary).toContain('Minimal compatibility');
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.passed).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.evidence).toEqual([]);
  });
});
