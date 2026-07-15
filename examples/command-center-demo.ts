/**
 * SafeLoop Command Center Demo
 *
 * Exercises the full AI governance story:
 * - Agent start/handoff chain
 * - Model calls with token cost and pricing
 * - Artifact changes
 * - Risk detection
 * - Approval request
 * - Decision explanation
 * - Operator action
 * - Task completion
 * - Billable timecard generation
 *
 * Run:
 *   npx ts-node examples/command-center-demo.ts
 *
 * Then start the monitor:
 *   npm run monitor -- --baseDir .safeloop-command-demo
 *
 * Open:
 *   http://127.0.0.1:3777           — Command Center dashboard
 *   http://127.0.0.1:3777/api/timecards/export  — Timecard export JSON
 */

import { recordModelUsage, appendEvent, setModelPricing } from '../src/index';
import { resolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const BASE = resolve(process.cwd(), '.safeloop-command-demo');
const SAFELOOP_DIR = `${BASE}/.safeloop`;

// Clean previous demo data
if (existsSync(`${SAFELOOP_DIR}/events.jsonl`)) {
  unlinkSync(`${SAFELOOP_DIR}/events.jsonl`);
  console.log('Cleared previous demo events.');
}
mkdirSync(SAFELOOP_DIR, { recursive: true });

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function now(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function main() {
  const options = { baseDir: BASE } as any;
  const caseId = 'demo-governance-case';
  const runId = id('run');

  console.log(`\nSafeLoop Command Center Demo`);
  console.log(`Session: ${runId}`);
  console.log(`Case: ${caseId}`);
  console.log(`Ledger: ${SAFELOOP_DIR}/events.jsonl\n`);

  // --- Step 0: Configure model pricing so cost displays are trustworthy ---
  setModelPricing([
    { provider: 'anthropic', model: 'claude-4-sonnet', inputPerMillion: 3.0, outputPerMillion: 15.0, currency: 'USD' },
    { provider: 'deepseek', model: 'deepseek-v4-flash', inputPerMillion: 0.14, outputPerMillion: 0.28, currency: 'USD' },
  ], options);
  console.log('[pricing] Configured model pricing for anthropic/claude-4-sonnet and deepseek/deepseek-v4-flash');

  // --- Step 1: Hermes starts planning ---
  appendEvent({
    id: id('evt'), type: 'task.started', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Hermes started planning: implement new SafeLoop billing module',
    timestamp: now(),
  }, options);
  console.log('[1] Hermes started planning');

  // --- Step 2: Hermes makes a decision ---
  appendEvent({
    id: id('evt'), type: 'decision.explained', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Hermes decided to split work between OpenCode (implementation) and DeepSeek (code review)',
    timestamp: now(1000),
    metadata: { rationale: 'Parallel execution reduces total time. DeepSeek handles review for cost efficiency.' },
  }, options);
  console.log('[2] Hermes explained decision');

  // --- Step 3: Hermes hands off to OpenCode ---
  appendEvent({
    id: id('evt'), type: 'handoff.created', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Hermes -> OpenCode: implement billing module',
    timestamp: now(2000),
    metadata: { from: 'Hermes', to: 'OpenCode', task: 'implement billing module' },
  }, options);
  console.log('[3] Handoff: Hermes -> OpenCode');

  // --- Step 4: OpenCode starts and calls Claude (model call with pricing) ---
  appendEvent({
    id: id('evt'), type: 'task.started', agentId: 'opencode', agentName: 'OpenCode',
    caseId, sessionId: runId,
    summary: 'OpenCode started implementing billing module',
    timestamp: now(3000),
  }, options);

  recordModelUsage({
    provider: 'anthropic', model: 'claude-4-sonnet', modelArchitecture: 'dense',
    inputTokens: 4200, outputTokens: 1800,
    agentId: 'opencode', agent: 'OpenCode',
    caseId, project: 'safeloop-billing', taskId: 'billing-impl', taskName: 'Implement billing module',
    sessionId: runId,
  }, options);
  console.log('[4] OpenCode called claude-4-sonnet (4200 in / 1800 out tokens)');

  // --- Step 5: OpenCode produces an artifact ---
  appendEvent({
    id: id('evt'), type: 'artifact.changed', agentId: 'opencode', agentName: 'OpenCode',
    caseId, sessionId: runId,
    summary: 'OpenCode created src/billing/timecardExport.ts',
    timestamp: now(5000),
    metadata: { path: 'src/billing/timecardExport.ts' },
  }, options);
  console.log('[5] Artifact: src/billing/timecardExport.ts');

  // --- Step 6: OpenCode hands off to DeepSeek for code review ---
  appendEvent({
    id: id('evt'), type: 'handoff.created', agentId: 'opencode', agentName: 'OpenCode',
    caseId, sessionId: runId,
    summary: 'OpenCode -> DeepSeek: review billing implementation',
    timestamp: now(6000),
    metadata: { from: 'OpenCode', to: 'DeepSeek', task: 'code review' },
  }, options);
  console.log('[6] Handoff: OpenCode -> DeepSeek');

  // --- Step 7: DeepSeek reviews (model call with pricing) ---
  recordModelUsage({
    provider: 'deepseek', model: 'deepseek-v4-flash', modelArchitecture: 'moe',
    inputTokens: 3500, outputTokens: 800,
    agentId: 'deepseek', agent: 'DeepSeek',
    caseId, project: 'safeloop-billing', taskId: 'billing-review', taskName: 'Code review',
    sessionId: runId,
  }, options);
  console.log('[7] DeepSeek called deepseek-v4-flash (3500 in / 800 out tokens)');

  // --- Step 8: DeepSeek detects a risk ---
  appendEvent({
    id: id('evt'), type: 'risk.detected', agentId: 'deepseek', agentName: 'DeepSeek',
    caseId, sessionId: runId,
    summary: 'Potential cost leak: billing export exposes internal pricing without access control',
    timestamp: now(8000),
    metadata: { severity: 'high', mitigation: 'Add authentication check before serving export endpoint' },
  }, options);
  console.log('[8] Risk detected: potential cost leak (high severity)');

  // --- Step 9: DeepSeek hands back to Hermes ---
  appendEvent({
    id: id('evt'), type: 'handoff.created', agentId: 'deepseek', agentName: 'DeepSeek',
    caseId, sessionId: runId,
    summary: 'DeepSeek -> Hermes: review complete, risk found',
    timestamp: now(9000),
    metadata: { from: 'DeepSeek', to: 'Hermes' },
  }, options);
  console.log('[9] Handoff: DeepSeek -> Hermes');

  // --- Step 10: Hermes requests human approval ---
  const approvalId = id('approval');
  appendEvent({
    id: approvalId, type: 'approval.requested', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Deploy billing module to production',
    timestamp: now(10000),
    metadata: { approver: 'Charles', reason: 'High-severity risk requires human review before deploy', approvalId },
  }, options);
  console.log('[10] Approval requested: deploy billing module (approver: Charles)');

  // --- Step 11: Operator acknowledges the risk ---
  appendEvent({
    id: id('evt'), type: 'operator.action.recorded', agentId: 'operator', agentName: 'Charles',
    caseId, sessionId: runId,
    summary: 'Operator acknowledged risk: potential cost leak',
    timestamp: now(12000),
    metadata: {
      source: { kind: 'operator-action' },
      action: 'acknowledged',
      targetId: 'risk-cost-leak',
      targetType: 'risk',
      note: 'Will add auth check before next deploy. Approved for staging.',
    },
  }, options);
  console.log('[11] Operator action: Charles acknowledged risk');

  // --- Step 12: Approval resolved ---
  appendEvent({
    id: id('evt'), type: 'approval.resolved', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Approval granted for staging deploy',
    timestamp: now(13000),
    metadata: { approvalId, decision: 'approved', approver: 'Charles' },
  }, options);
  console.log('[12] Approval resolved: approved by Charles');

  // --- Step 13: Feedback recorded ---
  appendEvent({
    id: id('evt'), type: 'feedback.recorded', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Positive feedback: billing module implementation was clean',
    timestamp: now(14000),
    metadata: { targetType: 'loop', rating: 'positive', score: 4, labels: ['clean-code', 'well-tested'], comment: 'Good implementation, risk was caught early', reviewer: 'Charles' },
  }, options);
  console.log('[13] Feedback: positive (score 4/5)');

  // --- Step 14: Task completed ---
  appendEvent({
    id: id('evt'), type: 'task.completed', agentId: 'hermes', agentName: 'Hermes',
    caseId, sessionId: runId,
    summary: 'Billing module implementation complete. Deployed to staging.',
    timestamp: now(15000),
  }, options);
  console.log('[14] Task completed');

  // --- Done ---
  console.log('\n--- Demo complete ---\n');
  console.log('To run the monitor against this demo data:');
  console.log('  npm run monitor -- --baseDir .safeloop-command-demo\n');
  console.log('Then open:');
  console.log('  http://127.0.0.1:3777                        — Command Center');
  console.log('  http://127.0.0.1:3777/api/dashboard          — Dashboard JSON');
  console.log('  http://127.0.0.1:3777/api/timecards/export   — Timecard Export\n');
  console.log('Expected in the Command Center:');
  console.log('  - Command Bar: session active, 1 risk, cost displayed');
  console.log('  - Circuit Map: 3 agent nodes + 2 model nodes + handoff/model_call edges');
  console.log('  - Evidence Stream: 14 typed events with icons');
  console.log('  - Command Rail: 1 billable candidate, token totals, cost');
  console.log('  - Export link: opens populated timecard JSON');
}

main().catch((e) => { console.error(e); process.exit(1); });
