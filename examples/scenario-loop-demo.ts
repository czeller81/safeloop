/**
 * SafeLoop Scenario Loop Demo
 *
 * Proves dimension-coded scenario governance:
 *   Scenario Contract → Step → Loop Decision → Guarded Action → Audit → Continue/Stop
 *
 * Story:
 * 1. Safe command: allowed → continue
 * 2. Dangerous command: blocked → stop
 * 3. Approval-required command: escalated → stop
 * 4. Success condition met: success → stop
 *
 * Run:
 *   npx ts-node examples/scenario-loop-demo.ts
 */

import { createScenarioLoop } from '../src/scenarioLoop';
import { readEvents } from '../src/eventStream';
import { resolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const BASE = resolve(process.cwd(), '.safeloop-scenario-demo');
const SAFELOOP_DIR = `${BASE}/.safeloop`;

if (existsSync(`${SAFELOOP_DIR}/events.jsonl`)) {
  unlinkSync(`${SAFELOOP_DIR}/events.jsonl`);
}
mkdirSync(SAFELOOP_DIR, { recursive: true });

const storageOptions = { baseDir: BASE };

console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
console.log('\u2551  SafeLoop Scenario Loop \u2014 Dimension-Coded Governance  \u2551');
console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n');

// --- Demo 1: Safe command continues ---
console.log('\u2501\u2501\u2501 Demo 1: Safe command \u2192 continue \u2501\u2501\u2501');
const loop1 = createScenarioLoop({
  contract: {
    scenarioId: 'demo-scenario',
    goal: 'produce verified result',
    successCondition: 'output contains test-pass',
    maxAttempts: 4,
    blockedCommands: ['rm -rf', 'format c:'],
    requireApprovalFor: ['git push', 'deploy'],
  },
  sessionId: `scenario-${Date.now()}`,
  agentId: 'demo-agent',
  agentName: 'DemoAgent',
  storageOptions,
});

const r1 = loop1.step({
  stepIndex: 0,
  actionType: 'command',
  command: 'node -e "console.log(\'test-pass\')"',
  description: 'Run verification command',
});
console.log(`  Decision: ${r1.decision}`);
console.log(`  shouldContinue: ${r1.shouldContinue}`);
console.log(`  Output: ${r1.commandOutput}`);
console.log(`  Outcome: ${r1.outcome}`);
console.log('');

// --- Demo 2: Dangerous command blocked ---
console.log('\u2501\u2501\u2501 Demo 2: Dangerous command \u2192 block \u2501\u2501\u2501');
const loop2 = createScenarioLoop({
  contract: {
    scenarioId: 'demo-danger',
    goal: 'test dangerous blocking',
    successCondition: 'n/a',
    blockedCommands: ['rm -rf'],
  },
  agentId: 'demo-agent',
  agentName: 'DemoAgent',
  storageOptions,
});

const r2 = loop2.step({
  stepIndex: 0,
  actionType: 'command',
  command: 'rm -rf .',
  description: 'Attempt destructive operation',
});
console.log(`  Decision: ${r2.decision}`);
console.log(`  shouldContinue: ${r2.shouldContinue}`);
console.log(`  Output: ${r2.commandOutput ?? '(none \u2014 command never ran)'}`);
console.log(`  Outcome: ${r2.outcome}`);
console.log(`  Reason: ${r2.reason}`);
console.log('');

// --- Demo 3: Approval-required command escalated ---
console.log('\u2501\u2501\u2501 Demo 3: Approval command \u2192 escalate \u2501\u2501\u2501');
const loop3 = createScenarioLoop({
  contract: {
    scenarioId: 'demo-approval',
    goal: 'test approval flow',
    successCondition: 'deployed',
    requireApprovalFor: ['git push'],
  },
  agentId: 'demo-agent',
  agentName: 'DemoAgent',
  storageOptions,
});

const r3 = loop3.step({
  stepIndex: 0,
  actionType: 'command',
  command: 'git push origin master',
  description: 'Deploy to production',
});
console.log(`  Decision: ${r3.decision}`);
console.log(`  shouldContinue: ${r3.shouldContinue}`);
console.log(`  Output: ${r3.commandOutput ?? '(none \u2014 awaiting approval)'}`);
console.log(`  Outcome: ${r3.outcome}`);
console.log(`  Reason: ${r3.reason}`);
console.log('');

// --- Demo 4: Success condition met ---
console.log('\u2501\u2501\u2501 Demo 4: Success signal \u2192 success \u2501\u2501\u2501');
const loop4 = createScenarioLoop({
  contract: {
    scenarioId: 'demo-success',
    goal: 'produce verified result',
    successCondition: 'all tests pass',
    maxAttempts: 10,
  },
  agentId: 'demo-agent',
  agentName: 'DemoAgent',
  storageOptions,
});

// Step 0: normal work
loop4.step({ stepIndex: 0, actionType: 'validation', description: 'Running tests...' });

// Step 1: success
const r4 = loop4.step({
  stepIndex: 1,
  actionType: 'validation',
  description: 'All tests pass',
  successSignal: true,
});
console.log(`  Decision: ${r4.decision}`);
console.log(`  shouldContinue: ${r4.shouldContinue}`);
console.log(`  Outcome: ${r4.outcome}`);
console.log(`  Reason: ${r4.reason}`);
console.log('');

// --- Audit trail ---
console.log('\u2501\u2501\u2501 Audit Trail \u2501\u2501\u2501');
const events = readEvents(storageOptions);
const scenarioEvents = events.filter(e => e.type === 'scenario.step');
console.log(`  Total events: ${events.length}`);
console.log(`  Scenario step events: ${scenarioEvents.length}`);
for (const ev of scenarioEvents) {
  const meta = ev.metadata as any;
  console.log(`    [${meta.scenarioId}] step ${meta.stepIndex}: ${meta.decision} \u2014 ${meta.reason}`);
}

console.log('\n\u2501\u2501\u2501 Proof Summary \u2501\u2501\u2501');
console.log(`\u2713 Safe command: decision=${r1.decision}, shouldContinue=${r1.shouldContinue}`);
console.log(`\u2713 Dangerous command: decision=${r2.decision}, shouldContinue=${r2.shouldContinue}, executed=${r2.commandOutput === undefined ? 'false' : 'true'}`);
console.log(`\u2713 Approval command: decision=${r3.decision}, shouldContinue=${r3.shouldContinue}, executed=${r3.commandOutput === undefined ? 'false' : 'true'}`);
console.log(`\u2713 Success signal: decision=${r4.decision}, shouldContinue=${r4.shouldContinue}`);
console.log(`\u2713 Scenario events: ${scenarioEvents.length}`);

const allPassed =
  r1.decision === 'continue' && r1.shouldContinue === true &&
  r2.decision === 'block' && r2.shouldContinue === false &&
  r3.decision === 'escalate' && r3.shouldContinue === false &&
  r4.decision === 'success' && r4.shouldContinue === false &&
  scenarioEvents.length >= 5;

console.log(`\n${allPassed ? '\u2705 ALL SCENARIO PROOFS PASSED' : '\u274C SOME PROOFS FAILED'}\n`);
if (!allPassed) process.exit(1);
