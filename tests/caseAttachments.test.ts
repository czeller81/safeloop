import {
  createCaseFile,
  exportCaseReportJSON,
  exportCaseReportMarkdown,
  recordHandoff,
} from '../src/index';

describe('case attachments', () => {
  it('creates, lists, and removes attachments safely', () => {
    let caseFile = createCaseFile({
      goal: 'Track supporting artifacts',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    caseFile = caseFile.attachArtifact({
      type: 'file',
      label: 'README',
      path: './README.md',
    });
    caseFile = caseFile.attachArtifact({
      type: 'url',
      label: 'GitHub PR',
      url: 'https://github.com/example/repo/pull/12',
      description: 'Reference pull request',
    });
    caseFile = caseFile.attachArtifact({
      type: 'report',
      label: 'Safety Report',
      path: './SAFELOOP_REPORT.md',
    });

    const attachments = caseFile.listAttachments();
    expect(attachments).toHaveLength(3);
    expect(attachments[0]).toMatchObject({
      type: 'file',
      label: 'README',
      path: './README.md',
    });
    expect(attachments[1]).toMatchObject({
      type: 'url',
      label: 'GitHub PR',
      url: 'https://github.com/example/repo/pull/12',
    });
    expect(attachments[2]).toMatchObject({
      type: 'report',
      label: 'Safety Report',
      path: './SAFELOOP_REPORT.md',
    });

    const filtered = caseFile.removeAttachment(attachments[1].id);
    expect(filtered.listAttachments()).toHaveLength(2);
    expect(filtered.listAttachments().map((attachment) => attachment.label)).toEqual([
      'README',
      'Safety Report',
    ]);
    expect(caseFile.listAttachments()).toHaveLength(3);
  });

  it('rejects unsupported attachment types', () => {
    const caseFile = createCaseFile({
      goal: 'Validate attachment types',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    expect(() =>
      caseFile.attachArtifact({
        type: 'other',
        label: 'Generic evidence',
        metadata: { source: 'manual' },
      }),
    ).not.toThrow();

    expect(() =>
      caseFile.attachArtifact({
        type: 'unsupported' as never,
        label: 'Bad attachment',
      }),
    ).toThrow('Unsupported attachment type: unsupported');
  });

  it('exports attachment data in markdown and JSON and supports handoff references', () => {
    let caseFile = createCaseFile({
      goal: 'Continue work with portable evidence',
      owner: 'Hermes',
      project: 'Safeloop',
    });

    caseFile = caseFile.attachArtifact({
      type: 'file',
      label: 'README',
      path: './README.md',
    });
    caseFile = caseFile.attachArtifact({
      type: 'report',
      label: 'Safety Report',
      path: './SAFELOOP_REPORT.md',
    });

    caseFile = recordHandoff(caseFile, {
      from: 'hermes',
      to: 'claude',
      notes: 'Continue implementation',
      recommendedNextActions: ['Review README', 'Review safety report'],
      attachmentIds: caseFile.listAttachments().map((attachment) => attachment.id),
    });

    const md = exportCaseReportMarkdown(caseFile);
    const json = exportCaseReportJSON(caseFile);

    expect(md).toContain('## Attachments');
    expect(md).toContain('README');
    expect(md).toContain('type: file');
    expect(md).toContain('path: ./README.md');
    expect(md).toContain('Safety Report');
    expect(md).toContain('type: report');
    expect(md).toContain('path: ./SAFELOOP_REPORT.md');
    expect(md).toContain('Attachment IDs');
    expect(md).toContain('claude');

    expect(json.caseFile.attachments).toHaveLength(2);
    expect(json.caseFile.handoffRecords[0].attachmentIds).toHaveLength(2);
    expect(json.summary.attachments).toBe(2);
    expect(json.caseFile.handoffRecords[0]).toMatchObject({
      currentOwner: 'hermes',
      nextOwner: 'claude',
      handoffNotes: 'Continue implementation',
      attachmentIds: json.caseFile.attachments.map((attachment) => attachment.id),
    });
  });
});
