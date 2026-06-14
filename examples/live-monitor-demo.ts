import {
  addParticipant,
  appendEvent,
  createCaseFile,
  recordModelUsage,
  recordSteeringProfile,
  setModelPricing,
  startMonitorServer,
} from '../src/index';

async function main(): Promise<void> {
  let caseFile = createCaseFile({
    goal: 'Demonstrate the Safeloop live loop monitor',
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

  setModelPricing(
    {
      provider: 'OpenAI',
      model: 'gpt-5-mini',
      inputPerMillion: 0.25,
      outputPerMillion: 2.0,
      currency: 'USD',
    },
    { baseDir: process.cwd() },
  );

  appendEvent(
    {
      id: 'live-evt-1',
      type: 'task.started',
      timestamp: new Date().toISOString(),
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Start the live monitor demo',
      metadata: { goal: caseFile.goal },
    },
    { baseDir: process.cwd() },
  );

  recordModelUsage(
    {
      provider: 'OpenAI',
      model: 'gpt-5-mini',
      modelArchitecture: 'hosted',
      inputTokens: 9000,
      outputTokens: 1300,
      agentId: 'hermes-1',
      caseId: caseFile.id,
      timestamp: new Date().toISOString(),
    },
    { baseDir: process.cwd() },
  );

  recordSteeringProfile(
    {
      steeringProfileId: 'live-steer-1',
      promptVersion: '1.0.0',
      instructionVersion: '1.0.0',
      agent: 'Hermes',
      model: 'gpt-5-mini',
      tokens: 10300,
      cost: 2.71,
      decisions: 4,
      risks: 1,
      approvals: 1,
      testsPassed: 2,
      releaseReadiness: 88,
      caseId: caseFile.id,
      timestamp: new Date().toISOString(),
    },
    { baseDir: process.cwd() },
  );

  appendEvent(
    {
      id: 'live-evt-2',
      type: 'handoff.created',
      timestamp: new Date().toISOString(),
      agentId: 'hermes-1',
      agentName: 'Hermes',
      participantId: 'Hermes',
      caseId: caseFile.id,
      summary: 'Hand off to OpenCode',
      metadata: { from: 'Hermes', to: 'OpenCode', notes: 'Continue implementation' },
    },
    { baseDir: process.cwd() },
  );

  const server = await startMonitorServer({ baseDir: process.cwd() });
  console.log(`Safeloop live monitor running at http://localhost:${server.port}`);
  console.log('Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
