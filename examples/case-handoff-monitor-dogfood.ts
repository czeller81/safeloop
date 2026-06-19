import { appendEvent } from '../src/eventStream';
import { resolveSafeloopPath } from '../src/localStorage';
import { resolve } from 'path';

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function now(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function main() {
  const baseDir = resolve(process.cwd(), '.safeloop-dogfood');
  const options = { baseDir };
  const eventsPath = resolveSafeloopPath('events.jsonl', options);

  console.log('Writing dogfood ledger to:', eventsPath);

  const caseId = 'case-dogfood-001';
  const taskId = 'task-feed-dog-001';
  const agentHermes = { agentId: 'hermes-1', agent: 'Hermes' };
  const agentOpenCode = { agentId: 'opencode-1', agent: 'OpenCode' };

  // Sequence of events to represent a full handoff + loop
  appendEvent({
    id: id('evt'),
    type: 'task.started',
    agentId: agentHermes.agentId,
    agentName: agentHermes.agent,
    caseId,
    sessionId: 'sess-1',
    summary: 'Start feeding task',
    metadata: { project: 'Safeloop', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(0),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'context.loaded',
    agentId: agentHermes.agentId,
    agentName: agentHermes.agent,
    caseId,
    sessionId: 'sess-1',
    summary: 'Loaded feeding-spec.md',
    metadata: { project: 'Safeloop', path: '/tmp/feeding-spec.md', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(1000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'artifact.changed',
    agentId: agentHermes.agentId,
    agentName: agentHermes.agent,
    caseId,
    sessionId: 'sess-1',
    summary: 'Attached feeding-spec.md',
    metadata: { project: 'Safeloop', path: '/tmp/feeding-spec.md', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(2000),
  }, options);

  // Record an explicit handoff from Hermes -> OpenCode
  appendEvent({
    id: id('evt'),
    type: 'handoff.created',
    agentId: agentHermes.agentId,
    agentName: agentHermes.agent,
    caseId,
    sessionId: 'sess-1',
    summary: 'Handoff Hermes -> OpenCode: implement feeder control loop and schedule',
    metadata: {
      project: 'Safeloop',
      from: agentHermes.agent,
      to: agentOpenCode.agent,
      fromId: agentHermes.agentId,
      toId: agentOpenCode.agentId,
      recommendedNextActions: ['read feeding-spec.md', 'implement schedule'],
      taskId,
      taskName: 'Feed the dog daily at 8am',
    },
    timestamp: now(3000),
  }, options);

  // Child/hydrated agent continues work: decision + approval
  appendEvent({
    id: id('evt'),
    type: 'decision.made',
    agentId: agentOpenCode.agentId,
    agentName: agentOpenCode.agent,
    caseId,
    sessionId: 'sess-2',
    summary: 'Implement schedule with retry on failure',
    metadata: { project: 'Safeloop', taskId, taskName: 'Feed the dog daily at 8am', rationale: 'Retry ensures temporary API faults do not stop feeding' },
    timestamp: now(4000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'approval.requested',
    agentId: agentOpenCode.agentId,
    agentName: agentOpenCode.agent,
    caseId,
    sessionId: 'sess-2',
    summary: 'Request approval for retry strategy',
    metadata: { project: 'Safeloop', approver: 'ops@local', reason: 'Consistency guarantees for feeder', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(5000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'approval.resolved',
    agentId: 'ops-1',
    agentName: 'Ops',
    caseId,
    sessionId: 'sess-2',
    summary: 'Approval granted for retry strategy',
    metadata: { project: 'Safeloop', approvalId: 'approval-1', decision: 'approved', approver: 'ops@local', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(6000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'task.completed',
    agentId: agentOpenCode.agentId,
    agentName: agentOpenCode.agent,
    caseId,
    sessionId: 'sess-2',
    summary: 'Feeder control loop implemented and scheduled',
    metadata: { project: 'Safeloop', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(7000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'report.generated',
    agentId: agentOpenCode.agentId,
    agentName: agentOpenCode.agent,
    caseId,
    sessionId: 'sess-2',
    summary: 'Hydrated case report generated (markdown)',
    metadata: { project: 'Safeloop', path: '/tmp/feeding-report.md', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(8000),
  }, options);

  appendEvent({
    id: id('evt'),
    type: 'feedback.recorded',
    agentId: 'qa-1',
    agentName: 'QA',
    caseId,
    sessionId: 'sess-2',
    summary: 'QA positive feedback: schedule verified',
    metadata: { project: 'Safeloop', rating: 'positive', comment: 'Schedule works', taskId, taskName: 'Feed the dog daily at 8am' },
    timestamp: now(9000),
  }, options);

  console.log('Dogfood ledger write complete.');
  console.log('Run the monitor against this dogfood ledger with:');
  console.log('node -e "(async()=>{const s=await require(\'./dist/monitor/server\').startMonitorServer({port:3777, baseDir:require(\'path\').resolve(\''.replace(/'/g, "\\'") + '/.safeloop-dogfood' + '\'\')}); console.log(\`Monitor running at http://127.0.0.1:${s.port}\`); })()"');
}

main();
