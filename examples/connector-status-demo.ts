/**
 * SafeLoop Connector Status Demo
 *
 * Shows the status of available agent connectors:
 * - Generic CLI connector (always available)
 * - Hermes connector (detected if installed)
 *
 * Run:
 *   npx ts-node examples/connector-status-demo.ts
 */

import { createGenericCliConnector, createHermesConnector } from '../src/connectors';

console.log('\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
console.log('\u2551  SafeLoop Agent Connector Status              \u2551');
console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n');

// --- Generic CLI Connector ---
console.log('\u2501\u2501\u2501 Generic CLI Connector \u2501\u2501\u2501');
const generic = createGenericCliConnector();
const gDetect = generic.detect();
const gStatus = generic.status();
console.log(`  Name: ${generic.name}`);
console.log(`  Found: ${gDetect.found}`);
console.log(`  Path: ${gDetect.path ?? 'n/a'}`);
console.log(`  Connected: ${gStatus.connected}`);
console.log(`  Mode: ${gStatus.mode}`);
console.log('  Notes:');
for (const note of gDetect.notes) {
  console.log(`    \u2022 ${note}`);
}
console.log('');

// --- Hermes Connector ---
console.log('\u2501\u2501\u2501 Hermes Connector \u2501\u2501\u2501');
const hermes = createHermesConnector();
const hDetect = hermes.detect();
const hStatus = hermes.status();
const hVerify = hermes.verify();
console.log(`  Name: ${hermes.name}`);
console.log(`  Found: ${hDetect.found}`);
console.log(`  Path: ${hDetect.path ?? 'not found'}`);
console.log(`  Connected: ${hStatus.connected}`);
console.log(`  Mode: ${hStatus.mode}`);
console.log('  Detection notes:');
for (const note of hDetect.notes) {
  console.log(`    \u2022 ${note}`);
}
console.log('  Verification:');
for (const check of hVerify.checks) {
  console.log(`    ${check.ok ? '\u2713' : '\u2717'} ${check.name}: ${check.message}`);
}
console.log('');

// --- Summary ---
console.log('\u2501\u2501\u2501 Summary \u2501\u2501\u2501');
console.log(`  Generic CLI: ${gStatus.connected ? 'CONNECTED' : 'NOT CONNECTED'} (${gStatus.mode})`);
console.log(`  Hermes: ${hStatus.connected ? 'CONNECTED' : 'NOT CONNECTED'} (${hStatus.mode})`);
console.log('');
console.log('  To connect any agent, route commands through:');
console.log(`    npx ts-node examples/safeloop-command.ts --command "<COMMAND>"`);
console.log('');
