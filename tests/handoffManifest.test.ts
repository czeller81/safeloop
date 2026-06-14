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
import type { CaseFile } from '../src/index';

describe('handoff manifest', () => {
  it('generates a minimal manifest safely', () => {
    const caseFile = createCaseFile({
      goal: 'Minimal handoff manifest',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    const manifest = generateHandoffManifest(caseFile);
    const markdown = exportHandoffManifestMarkdown(manifest);
    const json = exportHandoffManifestJSON(manifest);

    expect(manifest.caseId).toBe(caseFile.id);
    expect(manifest.currentOwner).toBe('Hermes');
    expect(manifest.nextOwner).toBe('Hermes');
    expect(manifest.requiredAttachments).toEqual([]);
    expect(manifest.openRisks).toEqual([]);
    expect(manifest.pendingApprovals).toEqual([]);
    expect(manifest.recentDecisions).toEqual([]);
    expect(manifest.recommendedActions).toEqual([]);
    expect(markdown).toContain('# Safeloop Handoff Manifest');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Current Owner');
    expect(markdown).toContain('## Next Owner');
    expect(markdown).toContain('## Participants');
    expect(markdown).toContain('## Required Attachments');
    expect(markdown).toContain('## Open Risks');
    expect(markdown).toContain('## Pending Approvals');
    expect(markdown).toContain('## Recent Decisions');
    expect(markdown).toContain('## Recommended Actions');
    expect(markdown).toContain('## Handoff Notes');
    expect(markdown).toContain('## Source Case');
    expect(json).toEqual(manifest);
  });

  it('generates manifest data with participants, attachments, risks, approvals, decisions, and handoff records', () => {
    let caseFile = createCaseFile({
      goal: 'Prepare the case for transfer',
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
      name: 'Charles Zeller',
      type: 'human',
      role: 'approver',
    });

    caseFile = addCaseContext(caseFile, {
      contextUsed: 'Existing breakout and accountability layer',
      createdBy: 'Hermes',
    });

    const roadmapAttachment = attachArtifact(caseFile, {
      type: 'document',
      label: 'Roadmap',
      path: './ROADMAP.md',
      description: 'v0.4 roadmap',
    });

    const ledgerAttachment = attachArtifact(roadmapAttachment, {
      type: 'report',
      label: 'Report',
      path: './SAFELOOP_REPORT.md',
    });

    const withDecision = recordCaseDecision(ledgerAttachment, {
      decision: 'Add a manifest layer before packages',
      rationale: 'Keep the next release lightweight and additive',
      createdBy: 'OpenCode',
    });

    const withSecondDecision = recordCaseDecision(withDecision, {
      decision: 'Keep attachments reference-only',
      rationale: 'Avoid copying or packaging artifacts in v0.4',
      createdBy: 'Hermes',
    });

    const withRisk = recordCaseRisk(withSecondDecision, {
      risk: 'Manifest could become too large',
      severity: 'medium',
      mitigation: 'Keep source case compact and attachment references only',
      createdBy: 'Hermes',
    });

    const requested = requestCaseApproval(withRisk, {
      subject: 'Approve manifest foundation',
      requestedBy: 'Hermes',
      requestedByParticipantId: 'Hermes',
      requestedFor: 'Charles Zeller',
      reason: 'Need approval before handoff',
    });

    const handoff = recordHandoff(requested, {
      from: 'Hermes',
      to: 'OpenCode',
      fromParticipantId: 'Hermes',
      toParticipantId: 'OpenCode',
      handoffNotes: 'Continue from the roadmap and manifest foundation.',
      recommendedNextActions: ['Review ROADMAP.md', 'Inspect the attached report'],
      attachmentIds: handoffAttachmentIds(ledgerAttachment),
    });

    const manifest = generateHandoffManifest(handoff);
    const markdown = exportHandoffManifestMarkdown(manifest);
    const json = exportHandoffManifestJSON(manifest);

    expect(manifest.currentOwner).toBe('Hermes');
    expect(manifest.nextOwner).toBe('OpenCode');
    expect(manifest.participants).toHaveLength(3);
    expect(manifest.requiredAttachments).toHaveLength(2);
    expect(manifest.openRisks).toHaveLength(1);
    expect(manifest.pendingApprovals).toHaveLength(1);
    expect(manifest.recentDecisions).toHaveLength(2);
    expect(manifest.recommendedActions).toEqual(['Review ROADMAP.md', 'Inspect the attached report']);
    expect(manifest.handoffNotes).toContain('Continue from the roadmap');
    expect(manifest.sourceCase.handoffIds).toHaveLength(1);
    expect(manifest.sourceCase.latestHandoffId).toBe(handoff.handoffRecords[0].id);
    expect(markdown).toContain('## Required Attachments');
    expect(markdown).toContain('ROADMAP.md');
    expect(markdown).toContain('## Open Risks');
    expect(markdown).toContain('## Pending Approvals');
    expect(markdown).toContain('## Recent Decisions');
    expect(markdown).toContain('## Recommended Actions');
    expect(json.sourceCase.participantIds).toContain('OpenCode');
    expect(json.requiredAttachments).toHaveLength(2);
    expect(json.pendingApprovals[0].status).toBe('requested');
  });

  it('supports legacy case files without participant directories or helper methods', () => {
    const legacyCaseFile = {
      id: 'case-legacy',
      goal: 'Legacy compatibility',
      owner: 'Hermes',
      project: 'Safeloop',
      participants: ['Hermes', 'OpenCode'],
      status: 'open',
      contextTrail: [],
      decisionLog: [],
      riskLog: [],
      approvals: [],
      handoffRecords: [],
      attachments: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      closedAt: null,
    } as unknown as CaseFile;

    const manifest = generateHandoffManifest(legacyCaseFile);

    expect(manifest.caseId).toBe('case-legacy');
    expect(manifest.participants.map((participant) => participant.id)).toEqual(['Hermes', 'OpenCode']);
    expect(manifest.requiredAttachments).toEqual([]);
    expect(manifest.sourceCase.participantIds).toEqual(['Hermes', 'OpenCode']);
  });
});

function handoffAttachmentIds(caseFile: CaseFile): string[] {
  return caseFile.attachments.map((attachment) => attachment.id);
}
