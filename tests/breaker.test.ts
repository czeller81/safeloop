import {
  BREAKER_PRESETS,
  createAgentRunLedger,
  createBreaker,
  createCodingAgentBreaker,
  toMarkdownReport,
  type BreakerResult,
} from '../src/index';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeThrower(msg: string) {
  return async () => {
    throw new Error(msg);
  };
}

function makeMultiThrower(errors: string[]) {
  let i = 0;
  return async () => {
    throw new Error(errors[i++ % errors.length]);
  };
}

function makeSuccess(value?: unknown) {
  return async () => value ?? 'ok';
}

async function cooperativeBlock(ctx: {
  signal: AbortSignal;
}): Promise<string> {
  while (!ctx.signal.aborted) {
    await sleep(5);
  }
  return 'cancelled';
}

describe('agent-circuit-breaker', () => {
  describe('retry limit', () => {
    it('stops after default maxRetries (3)', async () => {
      const breaker = createBreaker({ maxRepeatedErrors: 0 });
      const result = await breaker.run(makeThrower('always fails'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result.attempts).toBe(4);
      expect(result.lastError).toBe('always fails');
    });

    it('stops after custom maxRetries', async () => {
      const breaker = createBreaker({ maxRetries: 1, maxRepeatedErrors: 0 });
      const result = await breaker.run(makeThrower('fail'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result.attempts).toBe(2);
    });

    it('succeeds before hitting retry limit', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount < 3) throw new Error('not yet');
        return 'finally ok';
      };
      const breaker = createBreaker({
        maxRetries: 5,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(fn);
      expect(result.success).toBe(true);
      expect(result.data).toBe('finally ok');
    });
  });

  describe('token budget limit', () => {
    it('stops when per-task budget exceeded', async () => {
      const breaker = createBreaker({ tokenBudget: { perTask: 100 } });
      const result = await breaker.run(async () => {
        return { _tokenEstimate: 150 };
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('token_budget_task');
    });

    it('stops when per-step budget exceeded', async () => {
      const breaker = createBreaker({
        tokenBudget: { perStep: 50, perTask: 1000 },
      });
      const result = await breaker.run(async () => {
        return { _stepTokenCost: 75 };
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('token_budget_step');
    });

    it('tracks cumulative token usage on success after retry', async () => {
      let step = 0;
      const breaker = createBreaker({
        maxRetries: 5,
        maxRepeatedErrors: 0,
        tokenBudget: { perStep: 100, perTask: 50 },
      });
      const result = await breaker.run(async () => {
        step++;
        if (step === 1) throw new Error('first fail');
        return { _stepTokenCost: 60 };
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('token_budget_task');
      expect(result.tokenEstimate).toBe(60);
    });

    it('succeeds when within budget', async () => {
      const breaker = createBreaker({
        tokenBudget: { perStep: 100, perTask: 1000 },
      });
      const result = await breaker.run(async () => {
        return { _stepTokenCost: 50, value: 'done' };
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ _stepTokenCost: 50, value: 'done' });
    });

    it('counts tokens from failed attempts via error._stepTokenCost', async () => {
      const breaker = createBreaker({
        maxRetries: 3,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(async () => {
        const err = new Error('api failed');
        (err as any)._stepTokenCost = 25;
        throw err;
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      // 4 attempts x 25 tokens each = 100
      expect(result.tokenEstimate).toBe(100);
    });

    it('counts tokens from failed attempts via error._tokenEstimate', async () => {
      const breaker = createBreaker({
        maxRetries: 2,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(async () => {
        const err = new Error('api failed');
        (err as any)._tokenEstimate = 50;
        throw err;
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      // 3 attempts x 50 tokens each = 150
      expect(result.tokenEstimate).toBe(150);
    });

    it('counts tokens via ctx.recordTokenUsage() on both success and failure', async () => {
      const breaker = createBreaker({
        maxRetries: 2,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(async (ctx) => {
        ctx.recordTokenUsage(10);
        if (ctx.attempt < 3) {
          throw new Error('fail');
        }
        return 'done';
      });
      // 3 attempts x 10 tokens = 30
      expect(result.tokenEstimate).toBe(30);
    });

    it('records token_usage audit entries when recordTokenUsage is called', async () => {
      const breaker = createBreaker();
      await breaker.run(async (ctx) => {
        ctx.recordTokenUsage(99);
        return 'ok';
      });
      const entries = breaker.log();
      expect(entries.some((e) => e.type === 'token_usage')).toBe(true);
    });
  });

  describe('repeated error detection', () => {
    it('escalates when same error appears consecutively', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeThrower('disk full'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('repeated_error');
      expect(result.attempts).toBe(2);
      expect(result.lastError).toBe('disk full');
      expect(result.escalationMessage).toContain('disk full');
    });

    it('does not escalate on alternating errors', async () => {
      const breaker = createBreaker({
        maxRetries: 5,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(
        makeMultiThrower(['err A', 'err B', 'err C', 'err D']),
      );
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
    });

    it('can be disabled by setting maxRepeatedErrors to 0', async () => {
      const breaker = createBreaker({
        maxRepeatedErrors: 0,
        maxRetries: 3,
      });
      const result = await breaker.run(makeThrower('fail'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
    });

    it('respects custom maxRepeatedErrors threshold', async () => {
      let callCount = 0;
      const breaker = createBreaker({ maxRepeatedErrors: 3, maxRetries: 5 });
      const result = await breaker.run(async () => {
        callCount++;
        throw new Error('db timeout');
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('repeated_error');
      expect(result.attempts).toBe(3);
    });

    it('normalizes errors by stripping stack traces', async () => {
      const breaker = createBreaker();
      const fn = async () => {
        const err = new Error('API error');
        (err as any).stack =
          'Error: API error\n    at Object.<anonymous> (test.js:1:1)';
        throw err;
      };
      const result = await breaker.run(fn);
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('repeated_error');
      expect(result.lastError).toBe('API error');
    });
  });

  describe('scope freeze', () => {
    it('rejects scope change via proposeScopeChange()', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(async (ctx) => {
        ctx.proposeScopeChange('expand scope', ['write tests', 'add docs']);
        return 'done';
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('scope_freeze');
      expect(result.escalationMessage).toContain('expand scope');
    });

    it('rejects tasks that return new goals without proposal', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(async () => {
        return { value: 'ok', _newGoals: ['refactor everything'] };
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('scope_freeze');
    });

    it('rejects tasks that return newTasks without proposal', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(async () => {
        return { value: 'ok', newTasks: ['do more work'] };
      });
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('scope_freeze');
    });

    it('allows tasks without scope expansion', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(async () => {
        return { value: 'done' };
      });
      expect(result.success).toBe(true);
    });

    it('can disable scope freeze', async () => {
      const breaker = createBreaker({ scopeFreeze: false });
      let proposalResult = false;
      const result = await breaker.run(async (ctx) => {
        proposalResult = ctx.proposeScopeChange('expand', ['more stuff']);
        return 'done';
      });
      expect(proposalResult).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  describe('kill switch and AbortSignal', () => {
    it('halts a cooperative blocking task when tripped', async () => {
      const breaker = createBreaker({ maxRetries: 100 });
      setTimeout(() => breaker.trip('manual stop'), 20);
      const result = await breaker.run(cooperativeBlock);
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('kill_switch');
    });

    it('shows kill reason in escalation message', async () => {
      const breaker = createBreaker({ maxRetries: 100 });
      setTimeout(() => breaker.trip('user requested stop'), 20);
      const result = await breaker.run(cooperativeBlock);
      expect(result.escalationMessage).toContain('user requested stop');
    });

    it('passes AbortSignal to task function', async () => {
      const breaker = createBreaker();
      let receivedSignal: AbortSignal | null = null;
      setTimeout(() => breaker.trip('stop'), 20);
      await breaker.run(async (ctx) => {
        receivedSignal = ctx.signal;
        await cooperativeBlock(ctx);
      });
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal!.aborted).toBe(true);
    });

    it('task can detect abort signal mid-execution', async () => {
      const breaker = createBreaker({ maxRetries: 100 });
      let signalDetected = false;
      setTimeout(() => breaker.trip('cancel'), 30);
      await breaker.run(async (ctx) => {
        await sleep(50);
        signalDetected = ctx.signal.aborted;
        return 'done';
      });
      expect(signalDetected).toBe(true);
    });

    it('reset clears kill switch state', async () => {
      const breaker = createBreaker();
      breaker.trip('testing');
      expect(breaker.status().isTripped).toBe(true);
      breaker.reset();
      expect(breaker.status().isTripped).toBe(false);
    });
  });

  describe('escalation result shape', () => {
    it('returns structured fields on max retries', async () => {
      const breaker = createBreaker({
        maxRetries: 2,
        maxRepeatedErrors: 0,
      });
      const result = await breaker.run(makeThrower('timeout'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result).toHaveProperty('attempts');
      expect(result).toHaveProperty('tokenEstimate');
      expect(result).toHaveProperty('lastError');
      expect(result).toHaveProperty('escalationMessage');
      expect(result).toHaveProperty('auditEntries');
      expect(result.escalationMessage).toContain('timeout');
      expect(result.escalationMessage).toContain('What failed');
      expect(result.escalationMessage).toContain('What was tried');
      expect(result.escalationMessage).toContain('Why it stopped');
      expect(result.escalationMessage).toContain('What a human should decide');
    });

    it('returns structured fields on repeated error', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeThrower('API rate limit'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('repeated_error');
      expect(result.escalationMessage).toContain('API rate limit');
      expect(result.escalationMessage).toContain('What failed');
      expect(result.escalationMessage).toContain('What was tried');
      expect(result.escalationMessage).toContain('Why it stopped');
      expect(result.escalationMessage).toContain('What a human should decide');
    });

    it('includes audit trail in result', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeThrower('fail'));
      expect(result.auditEntries.length).toBeGreaterThan(0);
      const types = result.auditEntries.map((e) => e.type);
      expect(types).toContain('attempt');
      expect(types).toContain('failure');
      expect(types).toContain('breaker_trip');
    });

    it('includes all required result fields', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeThrower('boom'));
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('stoppedBy');
      expect(result).toHaveProperty('attempts');
      expect(result).toHaveProperty('tokenEstimate');
      expect(result).toHaveProperty('lastError');
      expect(result).toHaveProperty('escalationMessage');
      expect(result).toHaveProperty('auditEntries');
    });

    it('includes all required fields on success', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeSuccess('done'));
      expect(result.success).toBe(true);
      expect(result.stoppedBy).toBe('');
      expect(result.data).toBe('done');
      expect(result.escalationMessage).toBeNull();
    });
  });

  describe('audit log', () => {
    it('records attempts, failures, and breaker trip', async () => {
      const breaker = createBreaker();
      await breaker.run(makeThrower('fail'));
      const entries = breaker.log();
      expect(entries.some((e) => e.type === 'attempt')).toBe(true);
      expect(entries.some((e) => e.type === 'failure')).toBe(true);
      expect(entries.some((e) => e.type === 'breaker_trip')).toBe(true);
    });

    it('records budget checks', async () => {
      const breaker = createBreaker({ tokenBudget: { perTask: 10 } });
      await breaker.run(async () => ({ _tokenEstimate: 20 }));
      const entries = breaker.log();
      expect(entries.some((e) => e.type === 'budget_check')).toBe(true);
    });

    it('records kill switch events', async () => {
      const breaker = createBreaker({ maxRetries: 10 });
      setTimeout(() => breaker.trip('emergency stop'), 20);
      await breaker.run(cooperativeBlock);
      const entries = breaker.log();
      expect(entries.some((e) => e.type === 'kill_switch')).toBe(true);
    });

    it('records scope proposals and denials', async () => {
      const breaker = createBreaker();
      await breaker.run(async (ctx) => {
        ctx.proposeScopeChange('add features', ['feature x']);
        return 'done';
      });
      const entries = breaker.log();
      expect(entries.some((e) => e.type === 'scope_proposed')).toBe(true);
      expect(entries.some((e) => e.type === 'scope_denied')).toBe(true);
    });
  });

  describe('configurable policies', () => {
    it('uses defaults when no config provided', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(makeThrower('fail'));
      expect(result.stoppedBy).toBe('repeated_error');
    });

    it('accepts partial config', async () => {
      const breaker = createBreaker({ maxRetries: 5 });
      const result = await breaker.run(makeThrower('fail'));
      expect(result.stoppedBy).toBe('repeated_error');
    });

    it('overrides all defaults', async () => {
      const breaker = createBreaker({
        maxRetries: 5,
        maxRepeatedErrors: 0,
        tokenBudget: { perStep: 999, perTask: 9999 },
        scopeFreeze: false,
      });
      const result = await breaker.run(makeThrower('fail'));
      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result.attempts).toBe(6);
    });

    it('provides access to DEFAULTS', async () => {
      const { DEFAULTS } = await import('../src/index');
      expect(DEFAULTS.maxRetries).toBe(3);
      expect(DEFAULTS.maxRepeatedErrors).toBe(2);
    });
  });

  describe('BREAKER_PRESETS', () => {
    it('exports presets with correct conservativeCodingAgent values', () => {
      const { BREAKER_PRESETS } = require('../src/index');
      expect(BREAKER_PRESETS.conservativeCodingAgent).toEqual({
        maxRetries: 1,
        maxRepeatedErrors: 1,
        tokenBudget: { perStep: 4000, perTask: 12000 },
        scopeFreeze: true,
      });
    });

    it('exports presets with correct standardCodingAgent values', () => {
      const { BREAKER_PRESETS } = require('../src/index');
      expect(BREAKER_PRESETS.standardCodingAgent).toEqual({
        maxRetries: 2,
        maxRepeatedErrors: 2,
        tokenBudget: { perStep: 8000, perTask: 30000 },
        scopeFreeze: true,
      });
    });

    it('exports presets with correct exploratoryResearchAgent values', () => {
      const { BREAKER_PRESETS } = require('../src/index');
      expect(BREAKER_PRESETS.exploratoryResearchAgent).toEqual({
        maxRetries: 3,
        maxRepeatedErrors: 2,
        tokenBudget: { perStep: 12000, perTask: 60000 },
        scopeFreeze: false,
      });
    });

    it('works end-to-end with createBreaker(BREAKER_PRESETS.standardCodingAgent)', async () => {
      const { createBreaker, BREAKER_PRESETS } = require('../src/index');
      const breaker = createBreaker(BREAKER_PRESETS.standardCodingAgent);
      const result = await breaker.run(async () => {
        throw new Error('task failed');
      });
      expect(result.success).toBe(false);
      // maxRetries=2 => 3 total attempts, repeatedErrors=2 => trips on 2nd identical error
      expect(result.stoppedBy).toBe('repeated_error');
      expect(result.attempts).toBe(2);
    });
  });

  describe('coding agent helpers', () => {
    it('createCodingAgentBreaker() uses the standard preset by default', async () => {
      const breaker = createCodingAgentBreaker();
      let step = 0;
      const result = await breaker.run(async () => {
        step += 1;
        if (step <= 3) {
          throw new Error(`step ${step}`);
        }
        return 'done';
      });

      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result.attempts).toBe(3);
    });

    it('createCodingAgentBreaker() accepts overrides', async () => {
      const breaker = createCodingAgentBreaker({ maxRetries: 1, maxRepeatedErrors: 0 });
      let step = 0;
      const result = await breaker.run(async () => {
        step += 1;
        if (step <= 2) {
          throw new Error(`fail ${step}`);
        }
        return 'done';
      });

      expect(result.success).toBe(false);
      expect(result.stoppedBy).toBe('max_retries');
      expect(result.attempts).toBe(2);
    });

    it('createCodingAgentBreaker() does not mutate BREAKER_PRESETS', async () => {
      const snapshot = JSON.parse(
        JSON.stringify(BREAKER_PRESETS.standardCodingAgent),
      );
      createCodingAgentBreaker({ tokenBudget: { perTask: 1 } });
      expect(BREAKER_PRESETS.standardCodingAgent).toEqual(snapshot);
    });

    it('toMarkdownReport() returns Markdown for a failed result', () => {
      const result = {
        success: false,
        stoppedBy: 'repeated_error',
        attempts: 3,
        tokenEstimate: 123,
        lastError: 'disk full',
        escalationMessage:
          'The agent loop was stopped.\n\nWhat failed: disk full\nWhat was tried: 3 attempt(s) were made.\nWhy it stopped: The same error repeated.\nWhat a human should decide next: Review the task and error above.',
        auditEntries: [
          {
            timestamp: 1,
            type: 'attempt',
            message: 'Attempt 1',
          },
          {
            timestamp: 2,
            type: 'failure',
            message: 'Attempt 1 failed: disk full',
          },
          {
            timestamp: 3,
            type: 'breaker_trip',
            message: 'Repeated error detected',
          },
        ],
      } as BreakerResult;

      const md = toMarkdownReport(result);
      expect(md).toContain('# Agent Circuit Breaker Report');
      expect(md).toContain('Status: Failed');
      expect(md).toContain('Trip reason: repeated_error');
      expect(md).toContain('Attempts: 3');
      expect(md).toContain('Token usage: 123');
      expect(md).toContain('## Escalation');
      expect(md).toContain('Recommended human action: Review the task and error above.');
      expect(md).toContain('## Audit Summary');
      expect(md).toContain('* attempt');
      expect(md).toContain('* failure');
      expect(md).toContain('* breaker_trip');
    });

    it('toMarkdownReport() returns Markdown for a successful result', async () => {
      const breaker = createBreaker();
      const result = await breaker.run(async (ctx) => {
        ctx.recordTokenUsage(7);
        return 'done';
      });

      const md = toMarkdownReport(result);
      expect(md).toContain('# Agent Circuit Breaker Report');
      expect(md).toContain('Status: Succeeded');
      expect(md).toContain('Attempts: 1');
      expect(md).toContain('Token usage: 7');
      expect(md).toContain('## Audit Summary');
      expect(md).toContain('* attempt');
      expect(md).toContain('* retry');
      expect(md).not.toContain('## Escalation');
    });

    it('toMarkdownReport() handles missing optional fields safely', () => {
      const md = toMarkdownReport(
        {
          success: true,
          stoppedBy: '',
          attempts: 1,
        } as unknown as BreakerResult,
      );

      expect(md).toContain('Status: Succeeded');
      expect(md).toContain('Attempts: 1');
    });
  });

  describe('Agent Action Ledger', () => {
    it('creates a ledger with metadata', () => {
      const metadata = {
        runId: 'run-001',
        agent: 'Hermes',
        executor: 'OpenCode',
        repo: 'agent-circuit-breaker',
        task: 'tighten governance',
        allowedFiles: ['src/index.ts', 'tests/breaker.test.ts'],
        startedAt: '2026-06-13T00:00:00.000Z',
      };

      const ledger = createAgentRunLedger(metadata);
      const json = ledger.toJSON();

      expect(json.metadata).toEqual(metadata);
      expect(json.status).toBe('open');
      expect(json.closedAt).toBeNull();
      expect(metadata.allowedFiles).toEqual([
        'src/index.ts',
        'tests/breaker.test.ts',
      ]);
    });

    it('records prompt, command, changed files, validations, scope checks, approval, and close', () => {
      const ledger = createAgentRunLedger({
        runId: 'run-002',
        agent: 'Hermes',
        executor: 'OpenCode',
        repo: 'agent-circuit-breaker',
        task: 'agent ledger',
        allowedFiles: ['src/index.ts'],
        startedAt: '2026-06-13T00:00:00.000Z',
      });

      ledger.recordPrompt('Build the first version of the action ledger.');
      ledger.recordCommand('npm test', { exitCode: 0, summary: 'passed' });
      ledger.recordChangedFiles(['src/index.ts', 'tests/breaker.test.ts']);
      ledger.recordValidation('npm test', 'passed', '52 tests passed');
      ledger.recordScopeCheck({
        ok: false,
        allowed: ['src/index.ts', 'tests/breaker.test.ts'],
        violations: ['README.md'],
        message: 'README.md is out of scope',
      });
      ledger.recordApproval('Charles', 'approved', 'Looks good');
      ledger.close('completed');

      const json = ledger.toJSON();
      expect(json.prompts).toEqual([
        'Build the first version of the action ledger.',
      ]);
      expect(json.commands).toEqual([
        { command: 'npm test', result: { exitCode: 0, summary: 'passed' } },
      ]);
      expect(json.changedFiles).toEqual([
        ['src/index.ts', 'tests/breaker.test.ts'],
      ]);
      expect(json.validations).toEqual([
        {
          name: 'npm test',
          status: 'passed',
          details: '52 tests passed',
        },
      ]);
      expect(json.scopeChecks).toEqual([
        {
          ok: false,
          allowed: ['src/index.ts', 'tests/breaker.test.ts'],
          violations: ['README.md'],
          message: 'README.md is out of scope',
        },
      ]);
      expect(json.approvals).toEqual([
        {
          approver: 'Charles',
          decision: 'approved',
          note: 'Looks good',
        },
      ]);
      expect(json.status).toBe('completed');
      expect(json.closedAt).not.toBeNull();
    });

    it('returns readable markdown', () => {
      const ledger = createAgentRunLedger({
        runId: 'run-003',
        agent: 'Hermes',
        executor: 'OpenCode',
        repo: 'agent-circuit-breaker',
        task: 'write report',
        allowedFiles: ['src/index.ts'],
        startedAt: '2026-06-13T00:00:00.000Z',
      });

      ledger.recordPrompt('Draft the governance ledger.');
      ledger.recordCommand('npm run build', { exitCode: 0 });
      ledger.recordChangedFiles(['src/index.ts']);
      ledger.recordValidation('npm run build', 'passed');
      ledger.recordScopeCheck({ ok: true });
      ledger.recordApproval('Charles', 'needs_changes', 'Add more detail');
      ledger.close('blocked');

      const md = ledger.toMarkdown();
      expect(md).toContain('# Agent Run Ledger');
      expect(md).toContain('Run ID: run-003');
      expect(md).toContain('Status: blocked');
      expect(md).toContain('## Commands');
      expect(md).toContain('npm run build');
      expect(md).toContain('## Validations');
      expect(md).toContain('## Human Approval');
      expect(md).toContain('## Events');
    });

    it('handles missing optional fields safely', () => {
      const ledger = createAgentRunLedger({
        runId: 'run-004',
        agent: 'Hermes',
        executor: 'OpenCode',
        repo: 'agent-circuit-breaker',
        task: 'minimal run',
        allowedFiles: [],
        startedAt: '2026-06-13T00:00:00.000Z',
      });

      ledger.recordCommand('npm test');
      ledger.recordValidation('npm test', 'skipped');
      ledger.recordScopeCheck({ ok: true });
      ledger.recordApproval('Charles', 'rejected');
      ledger.close('escalated');

      const json = ledger.toJSON();
      expect(json.commands[0].result).toBeUndefined();
      expect(json.validations[0].details).toBeUndefined();
      expect(json.scopeChecks[0].message).toBeUndefined();
      expect(json.approvals[0].note).toBeUndefined();
      expect(ledger.toMarkdown()).toContain('None');
    });
  });

  describe('reset', () => {
    it('clears state for reuse', async () => {
      const breaker = createBreaker();
      await breaker.run(makeThrower('fail'));
      expect(breaker.status().attempts).toBeGreaterThan(0);
      breaker.reset();
      const st = breaker.status();
      expect(st.attempts).toBe(0);
      expect(st.isTripped).toBe(false);
      expect(breaker.log()).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('returns current state', async () => {
      const breaker = createBreaker();
      const st = breaker.status();
      expect(st).toHaveProperty('isTripped');
      expect(st).toHaveProperty('isKilled');
      expect(st).toHaveProperty('attempts');
      expect(st).toHaveProperty('tripReason');
    });

    it('marks status as tripped after a non-kill stop', async () => {
      const breaker = createBreaker();
      await breaker.run(async () => {
        throw new Error('boom');
      });

      const st = breaker.status();
      expect(st.isTripped).toBe(true);
      expect(st.isKilled).toBe(false);
    });
  });
});
