import { createCaseFile, recordHandoff, evaluateHandoffGovernance, recordCaseRisk, requestCaseApproval } from '../src';
import { generateHandoffManifest } from '../src/handoffManifest';

describe('handoff governance', () => {
  test('allows handoff when receiving contract preserves inherited constraints', () => {
    const caseFile = recordHandoff(createCaseFile({
      goal: 'complete local RAG task',
      owner: 'Hermes',
      project: 'district',
    }), {
      currentOwner: 'Hermes',
      nextOwner: 'Codex',
      handoffNotes: 'Continue validation only',
    });
    const manifest = generateHandoffManifest(caseFile);
    const inheritedContract = {
      scenarioId: 'handoff',
      goal: 'local work',
      successCondition: 'validated',
      allowedCommands: ['npm test'],
      blockedCommands: ['git push'],
      allowedTargets: ['local'],
      blockedTargets: ['production'],
    };

    const decision = evaluateHandoffGovernance({ manifest, inheritedContract });
    expect(decision.allowed).toBe(true);
  });

  test('rejects attempted privilege widening through handoff contract', () => {
    const caseFile = recordHandoff(createCaseFile({
      goal: 'complete local RAG task',
      owner: 'Hermes',
      project: 'district',
    }), {
      currentOwner: 'Hermes',
      nextOwner: 'Codex',
      handoffNotes: 'Continue validation only',
    });
    const manifest = generateHandoffManifest(caseFile);
    const inheritedContract = {
      scenarioId: 'handoff',
      goal: 'local work',
      successCondition: 'validated',
      allowedCommands: ['npm test'],
      blockedCommands: ['git push'],
      allowedTargets: ['local'],
      blockedTargets: ['production'],
    };
    const requestedContract = {
      ...inheritedContract,
      allowedCommands: ['npm test', 'git push'],
      allowedTargets: ['local', 'production'],
      blockedCommands: [],
    };

    const decision = evaluateHandoffGovernance({ manifest, inheritedContract, requestedContract });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'Requested handoff contract broadens allowed commands.',
      'Requested handoff contract broadens allowed targets.',
      'Requested handoff contract removes inherited blocked commands.',
    ]));
  });

  test('blocks handoff privilege expansion when approvals or high risks are unresolved', () => {
    let caseFile = createCaseFile({
      goal: 'complete local RAG task',
      owner: 'Hermes',
      project: 'district',
    });
    caseFile = recordCaseRisk(caseFile, {
      risk: 'Production data export risk',
      severity: 'high',
      mitigation: 'Do not export',
    });
    caseFile = requestCaseApproval(caseFile, {
      subject: 'Production access',
      requestedBy: 'Hermes',
    });
    caseFile = recordHandoff(caseFile, {
      currentOwner: 'Hermes',
      nextOwner: 'Codex',
      handoffNotes: 'Continue validation only',
    });

    const manifest = generateHandoffManifest(caseFile);
    const decision = evaluateHandoffGovernance({
      manifest,
      inheritedContract: {
        scenarioId: 'handoff',
        goal: 'local work',
        successCondition: 'validated',
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('pending approvals');
    expect(decision.reasons.join(' ')).toContain('high or critical open risks');
  });
});
