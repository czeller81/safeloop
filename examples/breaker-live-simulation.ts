import {
  createAgentRunLedger,
  createBreaker,
  toMarkdownReport,
  type BreakerResult,
} from '../src/index';

function assertScenario(
  name: string,
  condition: boolean,
  details: string,
): void {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}: ${details}`);
  if (!condition) {
    throw new Error(`Scenario failed: ${name}`);
  }
}

function summarize(result: BreakerResult): string {
  return [
    `success=${result.success}`,
    `stoppedBy=${result.stoppedBy || 'none'}`,
    `attempts=${result.attempts}`,
    `tokenEstimate=${result.tokenEstimate}`,
  ].join(', ');
}

async function repeatedErrorScenario(): Promise<BreakerResult> {
  const breaker = createBreaker();
  return breaker.run(async () => {
    throw new Error('simulated repeated failure');
  });
}

async function maxRetriesScenario(): Promise<BreakerResult> {
  let attempt = 0;
  const breaker = createBreaker({
    maxRetries: 2,
    maxRepeatedErrors: 0,
  });

  return breaker.run(async () => {
    attempt += 1;
    throw new Error(`changing failure ${attempt}`);
  });
}

async function tokenBudgetScenario(): Promise<BreakerResult> {
  const breaker = createBreaker({
    maxRetries: 5,
    maxRepeatedErrors: 0,
    tokenBudget: { perStep: 50, perTask: 100 },
  });

  return breaker.run(async (ctx) => {
    ctx.recordTokenUsage(80);
    return {
      ok: true,
      _stepTokenCost: 30,
    };
  });
}

async function scopeFreezeScenario(): Promise<BreakerResult> {
  const breaker = createBreaker({
    maxRetries: 0,
    maxRepeatedErrors: 0,
    scopeFreeze: true,
  });

  return breaker.run(async (ctx) => {
    const allowed = ctx.proposeScopeChange('also modify package.json', [
      'package.json',
    ]);

    return {
      ok: allowed,
      message: 'attempted scope expansion',
    };
  });
}

async function successfulRunScenario(): Promise<BreakerResult> {
  const breaker = createBreaker({
    maxRetries: 2,
    maxRepeatedErrors: 0,
    tokenBudget: { perStep: 100, perTask: 1000 },
    scopeFreeze: true,
  });

  return breaker.run(async (ctx) => {
    ctx.recordTokenUsage(10);
    return {
      ok: true,
      summary: 'safe agent run completed',
      _stepTokenCost: 20,
    };
  });
}

function printMarkdownReports(): void {
  const failedReport = toMarkdownReport({
    success: false,
    stoppedBy: 'repeated_error',
    attempts: 2,
    tokenEstimate: 0,
    lastError: 'simulated repeated failure',
    escalationMessage:
      'The agent loop was stopped.\n\nWhat failed: simulated repeated failure\nWhat was tried: 2 attempt(s) were made.\nWhy it stopped: The same error repeated.\nWhat a human should decide next: Review the task and error above.',
    auditEntries: [
      {
        timestamp: Date.now(),
        type: 'attempt',
        message: 'Attempt 1',
      },
    ],
  });

  const successReport = toMarkdownReport({
    success: true,
    stoppedBy: '',
    attempts: 1,
    tokenEstimate: 30,
    lastError: null,
    escalationMessage: null,
    auditEntries: [
      {
        timestamp: Date.now(),
        type: 'attempt',
        message: 'Attempt 1',
      },
      {
        timestamp: Date.now(),
        type: 'retry',
        message: 'Attempt 1 succeeded',
      },
    ],
    data: { ok: true },
  });

  console.log('\n=== Markdown report: failed run ===');
  console.log(failedReport);
  console.log('\n=== Markdown report: successful run ===');
  console.log(successReport);

  assertScenario(
    'markdown_report',
    failedReport.includes('Agent Circuit Breaker Report') &&
      failedReport.includes('Status: Failed') &&
      successReport.includes('Status: Succeeded') &&
      successReport.includes('## Audit Summary'),
    'rendered failed and successful markdown reports',
  );
}

function printLedger(): void {
  const ledger = createAgentRunLedger({
    runId: 'live-sim-001',
    agent: 'Hermes',
    executor: 'OpenCode simulation',
    repo: 'agent-circuit-breaker',
    task: 'control-loop simulation',
    allowedFiles: ['README.md'],
    startedAt: new Date().toISOString(),
  });

  ledger.recordPrompt('Simulate a local agent run and capture governance events.');
  ledger.recordCommand('npm test', { exitCode: 0, summary: 'simulated pass' });
  ledger.recordChangedFiles(['README.md']);
  ledger.recordValidation('npm test', 'passed', 'local simulation only');
  ledger.recordScopeCheck({
    ok: true,
    allowed: ['README.md'],
    message: 'simulation stayed within scope',
  });
  ledger.recordApproval('Charles', 'approved', 'simulation reviewed');
  ledger.close('completed');

  const markdown = ledger.toMarkdown();
  console.log('\n=== Agent Action Ledger ===');
  console.log(markdown);

  assertScenario(
    'agent_action_ledger',
    markdown.includes('Agent Run Ledger') &&
      markdown.includes('Run ID: live-sim-001') &&
      markdown.includes('Status: completed') &&
      markdown.includes('## Human Approval'),
    'recorded prompt, command, changed files, validation, scope check, and close',
  );
}

async function main(): Promise<void> {
  console.log('Agent Circuit Breaker live simulation');
  console.log('This is a local simulation only. No real OpenCode execution is used.');

  const repeatedError = await repeatedErrorScenario();
  console.log(`\n[repeated_error] ${summarize(repeatedError)}`);
  assertScenario(
    'repeated_error',
    !repeatedError.success && repeatedError.stoppedBy === 'repeated_error',
    `stoppedBy=${repeatedError.stoppedBy}`,
  );

  const maxRetries = await maxRetriesScenario();
  console.log(`\n[max_retries] ${summarize(maxRetries)}`);
  assertScenario(
    'max_retries',
    !maxRetries.success && maxRetries.stoppedBy === 'max_retries',
    `stoppedBy=${maxRetries.stoppedBy}`,
  );

  const tokenBudget = await tokenBudgetScenario();
  console.log(`\n[token_budget] ${summarize(tokenBudget)}`);
  assertScenario(
    'token_budget',
    !tokenBudget.success && tokenBudget.stoppedBy === 'token_budget_task',
    `stoppedBy=${tokenBudget.stoppedBy}`,
  );

  const scopeFreeze = await scopeFreezeScenario();
  console.log(`\n[scope_freeze] ${summarize(scopeFreeze)}`);
  assertScenario(
    'scope_freeze',
    !scopeFreeze.success && scopeFreeze.stoppedBy === 'scope_freeze',
    `stoppedBy=${scopeFreeze.stoppedBy}`,
  );

  const successfulRun = await successfulRunScenario();
  console.log(`\n[successful_run] ${summarize(successfulRun)}`);
  assertScenario(
    'successful_run',
    successfulRun.success && successfulRun.stoppedBy === '',
    `stoppedBy=${successfulRun.stoppedBy || 'none'}`,
  );

  printMarkdownReports();
  printLedger();

  console.log('\nSimulation complete. All scenarios passed.');
}

main().catch((error) => {
  console.error('\nSimulation failed:');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
