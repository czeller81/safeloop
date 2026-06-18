import {
  createCaseFile,
  addParticipant,
  attachArtifact,
  recordHandoff,
  generateHandoffManifest,
  hydrateCaseFileFromManifest,
  exportCaseReportMarkdown,
} from '../src/index';

function parentFlow() {
  let cf = createCaseFile({ goal: 'Implement dog-feeding flow', owner: 'Hermes', project: 'Demo' });
  cf = addParticipant(cf, { id: 'OpenCode', name: 'OpenCode', type: 'agent', role: 'implementer' });
  cf = attachArtifact(cf, { type: 'document', label: 'spec.md', path: '/tmp/spec.md' });
  cf = recordHandoff(cf, {
    from: 'Hermes',
    to: 'OpenCode',
    handoffNotes: 'Continue implementation from spec.md',
    recommendedNextActions: ['run tests', 'review README'],
    attachmentIds: cf.listAttachments().map((a) => a.id),
  });

  const manifest = generateHandoffManifest(cf);
  return manifest;
}

function childFlow(manifest: any) {
  const hydrated = hydrateCaseFileFromManifest(manifest, {
    receivingParticipantId: 'OpenCode',
    receivingParticipantName: 'OpenCode',
    preserveOriginalCaseId: true,
    recordReceivedHandoff: true,
  });

  console.log('--- Hydrated Case Report (markdown) ---\n');
  console.log(exportCaseReportMarkdown(hydrated));
}

const manifest = parentFlow();
childFlow(manifest);
