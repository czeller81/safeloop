import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCodexGovernedWorkflowDemo } from '../examples/codex-governed-workflow-demo';
import { readEvents } from '../src/eventStream';

describe('Codex governed workflow demo', () => {
  test('records allow, review, block, and effect guard decisions without fake Codex API integration', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-codex-demo-'));

    const result = runCodexGovernedWorkflowDemo(baseDir);
    const events = readEvents({ baseDir });

    expect(result.routeSpecialistId).toBe('coding');
    expect(result.allowedDecision).toBe('allow');
    expect(result.allowedExecuted).toBe(true);
    expect(result.approvalDecision).toBe('requires_approval');
    expect(result.approvalExecuted).toBe(false);
    expect(result.blockedDecision).toBe('deny');
    expect(result.blockedExecuted).toBe(false);
    expect(result.salesTerminalDecision).toBe('DENY');
    expect(result.deployDecision).toBe('DENY');
    expect(result.deployExecuted).toBe(false);

    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'task.started',
      'decision.explained',
      'command.allowed',
      'preflight.approval_required',
      'preflight.blocked',
      'decision.made',
      'effect.evaluated',
      'artifact.changed',
      'task.completed',
    ]));

    const serialized = JSON.stringify(events);
    expect(serialized).toContain('Codex');
    expect(serialized).not.toContain('OPENAI_API_KEY');
    expect(serialized).not.toContain('api.openai.com');
  });
});
