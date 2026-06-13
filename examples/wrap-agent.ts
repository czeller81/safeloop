import { createBreaker, BreakerContext } from '../src/index';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Demo 1: Repeated error detection stops a stuck agent.
 */
async function runRepeatedErrorDemo(): Promise<void> {
  const breaker = createBreaker({
    maxRetries: 5,
    maxRepeatedErrors: 2,
  });

  // Simulate an LLM call that always fails with the same error.
  async function agentTask(ctx: BreakerContext): Promise<string> {
    console.log(`--- Attempt ${ctx.attempt} ---`);
    throw new Error('LLM error: context window exhausted');
  }

  console.log('=== Demo 1: Repeated error stops an agent ===\n');
  const result = await breaker.run(agentTask);

  console.log(`\nResult:`);
  console.log(`  success:       ${result.success}`);
  console.log(`  stoppedBy:     ${result.stoppedBy}`);
  console.log(`  attempts:      ${result.attempts}`);
  console.log(`  lastError:     ${result.lastError}`);

  console.log(`\nEscalation:`);
  console.log(result.escalationMessage);
}

/**
 * Demo 2: Cooperative cancellation via AbortSignal.
 */
async function runCancellationDemo(): Promise<void> {
  const breaker = createBreaker({ maxRetries: 10 });

  setTimeout(() => {
    console.log('[user]  Cancellation requested...');
    breaker.trip('user pressed cancel');
  }, 450);

  async function longTask(ctx: BreakerContext): Promise<string> {
    for (let step = 1; step <= 10; step++) {
      if (ctx.signal.aborted) {
        console.log(`[agent]  Abort detected at step ${step}. Cleaning up...`);
        await sleep(50);
        return `cancelled at step ${step}`;
      }
      console.log(`[agent]  Step ${step}...`);
      await sleep(100);
    }
    return 'completed';
  }

  console.log('\n=== Demo 2: Cooperative cancellation ===\n');
  const result = await breaker.run(longTask);

  console.log(`\nResult:`);
  console.log(`  success:       ${result.success}`);
  console.log(`  stoppedBy:     ${result.stoppedBy}`);
}

/**
 * Demo 3: Scope freeze via proposeScopeChange().
 */
async function runScopeFreezeDemo(): Promise<void> {
  const breaker = createBreaker({ scopeFreeze: true });

  async function agentTask(ctx: BreakerContext): Promise<string> {
    const approved = ctx.proposeScopeChange(
      'extend task',
      ['write integration tests', 'deploy to staging'],
    );
    console.log(`[agent]  Scope expansion approved? ${approved}`);
    if (!approved) {
      console.log('[agent]  Staying within original scope.');
    }
    return 'task done within original scope';
  }

  console.log('\n=== Demo 3: Scope freeze ===\n');
  const result = await breaker.run(agentTask);

  console.log(`\nResult:`);
  console.log(`  success:       ${result.success}`);
  console.log(`  stoppedBy:     ${result.stoppedBy}`);
  if (result.escalationMessage) {
    console.log(`\n  ${result.escalationMessage.split('\n')[0]}`);
  }
}

/**
 * Demo 4: Token budget prevents excessive token use.
 */
async function runTokenBudgetDemo(): Promise<void> {
  const breaker = createBreaker({
    tokenBudget: { perStep: 100, perTask: 200 },
  });

  let totalTokens = 0;

  async function agentTask(ctx: BreakerContext): Promise<object> {
    const tokenCost = 80;
    totalTokens += tokenCost;
    console.log(`[agent]  Using ${tokenCost} tokens (total: ${totalTokens})`);
    return { _stepTokenCost: tokenCost, result: 'progress' };
  }

  console.log('\n=== Demo 4: Token budget limit ===\n');

  // We need to make the task fail to trigger retries so we can accumulate.
  // For simplicity, we just show the first successful call trip the budget.
  const result = await breaker.run(agentTask);
  // Total tokens after one successful call: 80. That's under the per-task
  // budget of 200, so this call succeeds and we never retry.
  console.log(`\nResult:`);
  console.log(`  success:       ${result.success}`);
  console.log(`  tokenEstimate: ${result.tokenEstimate}`);

  // Reset and demonstrate budget exceeded in one step.
  const breaker2 = createBreaker({
    tokenBudget: { perStep: 50, perTask: 1000 },
  });

  console.log('\n--- Per-step budget exceeded ---');
  const result2 = await breaker2.run(async () => {
    return { _stepTokenCost: 75, result: 'too expensive' };
  });

  console.log(`\nResult:`);
  console.log(`  success:       ${result2.success}`);
  console.log(`  stoppedBy:     ${result2.stoppedBy}`);
}

async function main(): Promise<void> {
  await runRepeatedErrorDemo();
  await runCancellationDemo();
  await runScopeFreezeDemo();
  await runTokenBudgetDemo();
}

main().catch(console.error);
