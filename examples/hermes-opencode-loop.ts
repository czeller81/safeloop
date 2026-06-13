import { createBreaker, BreakerContext } from '../src/index';

/**
 * Hermes/OpenCode coding task runner wrapped in a circuit breaker.
 *
 * In production, Hermes would:
 *   1. Create a JSON task file describing the goal and allowed files
 *   2. Invoke the PowerShell wrapper:
 *      & "C:\Users\CharlesZeller\hermes-tools\run-opencode-safeloop.ps1" `
 *        -TaskFile "task-<id>.json"
 *   3. The wrapper executes OpenCode inside the circuit breaker
 *
 * This example simulates that loop in safe TypeScript with no real I/O.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface TaskSpec {
  goal: string;
  allowedFiles: string[];
  modifiedFiles: string[];
}

function createTask(goal: string, allowedFiles: string[]): TaskSpec {
  return { goal, allowedFiles, modifiedFiles: [] };
}

/**
 * Simulates one Hermes/OpenCode coding step.
 *
 * In production, this would be the OpenCode agent prompt/execution cycle,
 * invoked via the PowerShell wrapper at:
 *   C:\Users\CharlesZeller\hermes-tools\run-opencode-safeloop.ps1
 */
async function simulateCodingStep(
  ctx: BreakerContext,
  stepNumber: number,
  task: TaskSpec,
): Promise<void> {
  const tokenCost = 300;
  ctx.recordTokenUsage(tokenCost);

  if (stepNumber === 1) {
    console.log(`    [opencode] Reading task: "${task.goal}"`);
    console.log(`    [opencode] Loading README.md... (~${tokenCost} tokens)`);

    // On attempt 1, simulate a transient API failure to demonstrate retry
    if (ctx.attempt === 1) {
      await sleep(30);
      console.log(`    [opencode] ERROR: LLM API call failed (context window exhausted)`);
      throw new Error('LLM API error: context window exhausted');
    }

    await sleep(50);
    task.modifiedFiles.push('README.md');
    console.log(`    [opencode] README.md loaded. Improving documentation...`);
  }

  if (stepNumber === 2) {
    console.log(`    [opencode] Agent has an idea: add build scripts to package.json`);
    console.log(`    [opencode] Proposing to modify: package.json (${tokenCost} tokens)`);

    // This triggers scope-freeze protection.
    // proposeScopeChange() returns false when scopeFreeze is enabled.
    // After the task function returns, the breaker will trip with 'scope_freeze'.
    const approved = ctx.proposeScopeChange(
      'modify package.json for build scripts',
      ['update package.json with build and test scripts'],
    );

    if (!approved) {
      console.log(`    [opencode] Scope change DENIED (scopeFreeze is enabled).`);
      console.log(`    [opencode] Agent: "Acknowledged. Staying within original scope."`);
      console.log(`    [opencode] (Breaker records the attempt anyway -- safety first.)`);
    }
  }
}

async function main(): Promise<void> {
  console.log('=== Hermes / OpenCode Task Runner with Circuit Breaker ===\n');

  const task = createTask(
    'Improve README.md documentation only',
    ['README.md'],
  );

  console.log(`Task: "${task.goal}"`);
  console.log(`Allowed files: ${task.allowedFiles.join(', ')}\n`);

  // Circuit breaker guards the entire Hermes/OpenCode loop
  const breaker = createBreaker({
    maxRetries: 2,
    maxRepeatedErrors: 2,
    tokenBudget: { perStep: 1000, perTask: 5000 },
    scopeFreeze: true,
  });

  console.log('Breaker config:');
  console.log('  maxRetries:        2');
  console.log('  maxRepeatedErrors: 2');
  console.log('  tokenBudget:       { perStep: 1000, perTask: 5000 }');
  console.log('  scopeFreeze:       true\n');

  const result = await breaker.run(async (ctx: BreakerContext) => {
    console.log(`[hermes] Attempt ${ctx.attempt} of 3\n`);

    // In production, Hermes writes a task file and calls the PowerShell wrapper:
    console.log(`  Hermes writes task-${ctx.attempt}.json and invokes:`);
    console.log(
      `    & "C:\\Users\\CharlesZeller\\hermes-tools\\run-opencode-safeloop.ps1" ` +
        `-TaskFile "task-${ctx.attempt}.json"`,
    );
    console.log();

    for (let step = 1; step <= 2; step++) {
      console.log(`  [hermes] Step ${step}/2 ---`);
      await simulateCodingStep(ctx, step, task);
      console.log();
    }

    console.log('  [hermes] OpenCode step loop completed.\n');
    // Return _stepTokenCost: 0 because all tokens were recorded via recordTokenUsage()
    return { _stepTokenCost: 0 };
  });

  console.log('=== Result ===');
  console.log(`  success:       ${result.success}`);
  console.log(`  stoppedBy:     ${result.stoppedBy}`);
  console.log(`  attempts:      ${result.attempts}`);
  console.log(`  tokenEstimate: ${result.tokenEstimate}`);
  console.log(`  lastError:     ${result.lastError}\n`);

  if (!result.success && result.escalationMessage) {
    console.log('=== Human Escalation ===');
    console.log(result.escalationMessage);
    console.log();
  }

  console.log('=== Audit Trail ===');
  for (const entry of result.auditEntries) {
    const type = entry.type.padEnd(18);
    console.log(`  ${type} ${entry.message}`);
  }
}

main().catch(console.error);
