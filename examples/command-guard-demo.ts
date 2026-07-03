/**
 * SafeLoop Command Guard Demo
 *
 * Proves the enforced local circuit breaker:
 *   Agent → SafeLoop Guard → Action
 *
 * Shows three paths:
 * 1. Safe command: allowed and executed
 * 2. Dangerous command: blocked BEFORE execution
 * 3. Approval-required command: does not execute immediately
 *
 * Run:
 *   npx ts-node examples/command-guard-demo.ts
 */

import { createCommandGuard } from '../src/commandGuard';
import { readEvents } from '../src/eventStream';
import { resolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const BASE = resolve(process.cwd(), '.safeloop-guard-demo');
const SAFELOOP_DIR = `${BASE}/.safeloop`;

// Clean previous demo data
if (existsSync(`${SAFELOOP_DIR}/events.jsonl`)) {
  unlinkSync(`${SAFELOOP_DIR}/events.jsonl`);
}
mkdirSync(SAFELOOP_DIR, { recursive: true });

const storageOptions = { baseDir: BASE };

// Create a command guard with realistic policy
const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    blockedCommands: ['rm -rf', 'format c:', 'del /f /s', 'DROP TABLE', 'sudo rm'],
    requireApprovalFor: ['git push', 'deploy', 'npm publish'],
  },
  sessionId: `guard-demo-${Date.now()}`,
  caseId: 'guard-demo-case',
  agentId: 'demo-agent',
  agentName: 'DemoAgent',
  storageOptions,
});

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  SafeLoop Command Guard — Enforced Circuit Breaker  ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// --- Test 1: Safe command (allowed) ---
console.log('━━━ Test 1: Safe command ━━━');
console.log('Command: node -e "console.log(\'safeloop-ok\')"');
const r1 = guard.run('node -e "console.log(\'safeloop-ok\')"');
console.log(`Decision: ${r1.decision}`);
console.log(`Executed: ${r1.executed}`);
console.log(`Output: ${r1.output}`);
console.log(`Exit code: ${r1.exitCode}`);
console.log('');

// --- Test 2: Dangerous command (blocked) ---
console.log('━━━ Test 2: Dangerous command ━━━');
console.log('Command: rm -rf .');
const r2 = guard.run('rm -rf .');
console.log(`Decision: ${r2.decision}`);
console.log(`Executed: ${r2.executed}`);
console.log(`Violations: ${JSON.stringify(r2.violations)}`);
console.log(`Output: ${r2.output ?? '(none — command never ran)'}`);
console.log('');

// --- Test 3: Approval-required command ---
console.log('━━━ Test 3: Approval-required command ━━━');
console.log('Command: git push origin master');
const r3 = guard.run('git push origin master');
console.log(`Decision: ${r3.decision}`);
console.log(`Executed: ${r3.executed}`);
console.log(`Reasons: ${JSON.stringify(r3.reasons)}`);
console.log(`Output: ${r3.output ?? '(none — awaiting approval)'}`);
console.log('');

// --- Audit trail ---
console.log('━━━ Audit Trail ━━━');
const events = readEvents(storageOptions);
console.log(`Events recorded: ${events.length}`);
for (const ev of events) {
  console.log(`  [${ev.type}] ${ev.summary}`);
}

console.log('\n━━━ Proof Summary ━━━');
console.log(`✓ Safe command: executed=${r1.executed} (should be true)`);
console.log(`✓ Dangerous command: executed=${r2.executed} (should be false)`);
console.log(`✓ Approval command: executed=${r3.executed} (should be false)`);
console.log(`✓ Events emitted: ${events.length} (should be 3)`);

const allPassed = r1.executed === true && r2.executed === false && r3.executed === false && events.length === 3;
console.log(`\n${allPassed ? '✅ ALL PROOFS PASSED' : '❌ SOME PROOFS FAILED'}\n`);

if (!allPassed) process.exit(1);
