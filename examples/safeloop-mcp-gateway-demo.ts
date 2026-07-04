/**
 * SafeLoop MCP Gateway Demo
 *
 * Shows the 4 gateway tools:
 * - status: gateway info
 * - checkCommand: preflight (no execution)
 * - runCommand: governed execution
 * - recordActivity: audit-only event
 *
 * Run: npx ts-node examples/safeloop-mcp-gateway-demo.ts
 */

import { createMcpGateway } from '../src/mcp';
import { readEvents } from '../src/eventStream';
import { resolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

const BASE = resolve(process.cwd(), '.safeloop-mcp-demo');
const LEDGER = `${BASE}/.safeloop`;
if (existsSync(`${LEDGER}/events.jsonl`)) unlinkSync(`${LEDGER}/events.jsonl`);
mkdirSync(LEDGER, { recursive: true });

const gw = createMcpGateway({ baseDir: BASE, defaultAgentId: 'demo-agent', defaultAgentName: 'DemoAgent' });

console.log('\n=== SafeLoop MCP Gateway Demo ===\n');

// 1. Status
console.log('--- status ---');
const s = gw.status();
console.log(`  Service: ${s.service}`);
console.log(`  Tools: ${s.tools.join(', ')}`);
console.log(`  Boundary: ${s.enforcementBoundary}`);
console.log('');

// 2. checkCommand safe
console.log('--- checkCommand (safe) ---');
const c1 = gw.checkCommand({ command: 'echo hello' });
console.log(`  Decision: ${c1.decision}, executed: ${c1.executed}, checkOnly: ${c1.checkOnly}`);

// 3. checkCommand dangerous
console.log('--- checkCommand (dangerous) ---');
const c2 = gw.checkCommand({ command: 'rm -rf .' });
console.log(`  Decision: ${c2.decision}, executed: ${c2.executed}, violations: ${JSON.stringify(c2.violations)}`);

// 4. checkCommand approval
console.log('--- checkCommand (approval) ---');
const c3 = gw.checkCommand({ command: 'git push origin master' });
console.log(`  Decision: ${c3.decision}, executed: ${c3.executed}, reasons: ${JSON.stringify(c3.reasons)}`);

// 5. runCommand safe
console.log('--- runCommand (safe) ---');
const r1 = gw.runCommand({ command: 'node -e "console.log(\'SAFELOOP_MCP_OK\')"' });
console.log(`  Decision: ${r1.decision}, executed: ${r1.executed}, output: ${r1.output}`);

// 6. recordActivity
console.log('--- recordActivity ---');
const a1 = gw.recordActivity({ activityType: 'file.write', target: 'src/main.ts', summary: 'Updated file' });
console.log(`  Recorded: ${a1.recorded}, eventId: ${a1.eventId}`);

// Summary
const events = readEvents({ baseDir: BASE });
console.log(`\n--- Ledger: ${events.length} events ---`);
console.log(`\n✅ MCP Gateway demo complete.\n`);
