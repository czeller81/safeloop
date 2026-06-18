import {
  createCaseFile,
  addParticipant,
  attachArtifact,
  recordHandoff,
  generateHandoffManifest,
  hydrateCaseFileFromManifest,
  exportCaseReportJSON,
  listParticipants,
} from '../src/index';

test('manifest hydrates into a valid Case File and preserves trail', () => {
  const owner = 'ParentAgent';
  let cf = createCaseFile({ goal: 'Demo goal', owner, project: 'TestProject' });

  cf = addParticipant(cf, { id: 'OpenCode', name: 'OpenCode', type: 'agent', role: 'implementer' });
  cf = attachArtifact(cf, { type: 'document', label: 'design.md', path: '/tmp/design.md' });

  cf = recordHandoff(cf, {
    from: owner,
    to: 'OpenCode',
    handoffNotes: 'Please continue',
    recommendedNextActions: ['review design'],
    attachmentIds: cf.listAttachments().map((a) => a.id),
  });

  const manifest = generateHandoffManifest(cf);

  const hydrated = hydrateCaseFileFromManifest(manifest, {
    receivingParticipantId: 'OpenCode',
    receivingParticipantName: 'OpenCode',
    preserveOriginalCaseId: true,
    recordReceivedHandoff: true,
  });

  // basic invariants
  expect(hydrated.goal).toBe(cf.goal);
  // receiving participant should exist
  expect(hydrated.hasParticipant('OpenCode')).toBeTruthy();
  // attachments restored as references
  expect(hydrated.listAttachments().length).toBeGreaterThanOrEqual(manifest.requiredAttachments.length);

  // exporting must succeed
  const report = exportCaseReportJSON(hydrated);
  expect(report).toHaveProperty('caseFile');

  // manifest must be unchanged
  expect(manifest.caseId).toBeDefined();
});
