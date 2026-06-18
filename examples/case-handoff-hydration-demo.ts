import {
  createCaseFile,
  addParticipant,
  attachArtifact,
  recordHandoff,
  generateHandoffManifest,
  hydrateCaseFileFromManifest,
  exportCaseReportMarkdown,
  recordCaseDecision,
} from '../src/index';

// Parent (main agent) flow: create case, add OpenCode participant, attach spec,
// record explicit handoff, generate manifest and hand it to the child.
function parentFlow() {
  let cf = createCaseFile({ goal: 'Feed the dog daily at 8am', owner: 'Hermes', project: 'DogFeeder' });

  // Ensure OpenCode is a participant
  cf = addParticipant(cf, { id: 'OpenCode', name: 'OpenCode', type: 'agent', role: 'implementer' });

  // Attach a spec (simulated)
  cf = attachArtifact(cf, { type: 'document', label: 'feeding-spec.md', path: '/tmp/feeding-spec.md', description: 'Feeding schedule and constraints' });

  // Record an explicit handoff from Hermes -> OpenCode
  cf = recordHandoff(cf, {
    from: 'Hermes',
    to: 'OpenCode',
    handoffNotes: 'Implement feeder control loop and schedule',
    recommendedNextActions: ['read feeding-spec.md', 'implement schedule'],
    attachmentIds: cf.listAttachments().map((a) => a.id),
  });

  const manifest = generateHandoffManifest(cf);
  return manifest;
}

// Child (sub-agent) flow: receive manifest, hydrate, add a decision and continue
function childFlow(manifest: any) {
  const hydrated = hydrateCaseFileFromManifest(manifest, {
    receivingParticipantId: 'OpenCode',
    receivingParticipantName: 'OpenCode',
    preserveOriginalCaseId: true,
    recordReceivedHandoff: true,
  });

  // Child records continued work: a decision and an added context note
  const withDecision = recordCaseDecision(hydrated, {
    decision: 'Implement schedule with retry on failure',
    rationale: 'Retry ensures temporary API faults do not stop feeding',
    createdBy: 'OpenCode',
  });

  console.log('--- Hydrated Case Report (markdown) ---\n');
  console.log(exportCaseReportMarkdown(withDecision));
  return withDecision;
}

const manifest = parentFlow();
childFlow(manifest);
