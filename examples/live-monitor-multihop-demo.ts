import { recordModelUsage, appendEvent } from '../src/index';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

// Demo writer: emits a multi-hop flow and token costs into .safeloop-live-demo
// This script writes Hermes -> OpenCode -> DeepSeek -> OpenCode -> Hermes events
// It intentionally does NOT POST operator actions; instead it prints a curl command
// you can run manually to exercise the /api/operator/actions endpoint.

const BASE = resolve(process.cwd(), '.safeloop-live-demo');
mkdirSync(`${BASE}/.safeloop`, { recursive: true });

function id(prefix: string){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*10000)}` }
function now(offsetMs = 0){ return new Date(Date.now() + offsetMs).toISOString(); }

async function main(){
  const options = { baseDir: BASE } as any;
  const caseId = 'live-demo-case';

  appendEvent({ id: id('evt'), type: 'task.started', agentId: 'hermes', agentName: 'Hermes', caseId, sessionId: 's1', summary: 'Hermes started planning', timestamp: now() }, options);

  appendEvent({ id: id('evt'), type: 'handoff.created', agentId: 'hermes', agentName: 'Hermes', caseId, sessionId: 's1', summary: 'Hermes -> OpenCode: implement feature', timestamp: now(1000), metadata:{from:'Hermes', to:'OpenCode', task:'implement feature'} }, options);

  appendEvent({ id: id('evt'), type: 'task.started', agentId: 'opencode', agentName: 'OpenCode', caseId, sessionId: 's2', summary: 'OpenCode started work', timestamp: now(2000) }, options);

  // OpenCode calls DeepSeek (model) and we record token usage (this writes token.cost/model.usage entries)
  const usage = recordModelUsage({ provider:'deepsdk', model:'deepscan-v1', modelArchitecture:'hosted', inputTokens: 1200, outputTokens: 300, agentId:'opencode', agent:'OpenCode', caseId, project:'demo', taskId:'deepscan', taskName:'DeepSeek call' }, options);

  appendEvent({ id: id('evt'), type: 'artifact.changed', agentId: 'opencode', agentName: 'OpenCode', caseId, sessionId: 's2', summary: 'OpenCode applied artifact change', timestamp: now(4000), metadata:{path:'/tmp/demo.txt'} }, options);

  appendEvent({ id: id('evt'), type: 'handoff.created', agentId: 'opencode', agentName: 'OpenCode', caseId, sessionId: 's2', summary: 'OpenCode -> Hermes: ready for review', timestamp: now(5000), metadata:{from:'OpenCode', to:'Hermes'} }, options);

  appendEvent({ id: id('evt'), type: 'decision.explained', agentId: 'hermes', agentName: 'Hermes', caseId, sessionId: 's3', summary: 'Hermes explanation for approach', timestamp: now(6000), metadata:{rationale:'demo reasons'} }, options);

  console.log('live demo write complete');
  console.log('To exercise operator action via the monitor, run (replace port if different):');
  console.log(`curl -X POST http://127.0.0.1:3777/api/operator/actions \\n  -H "Content-Type: application/json" \\n  -d '{"action":"acknowledged","targetId":"live-demo-target","caseId":"live-demo-case","agent":"Charles","targetType":"attention-item","note":"Live monitor test acknowledged from browser demo"}'`);
}

main().catch((e)=>{ console.error(e); process.exit(1) });
