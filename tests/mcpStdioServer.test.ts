import { handleMessage } from '../src/mcp/stdioServer';
import { createMcpGateway } from '../src/mcp';
import { readEvents } from '../src/eventStream';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makeTempGateway() {
  const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-mcp-stdio-'));
  mkdirSync(join(baseDir, '.safeloop'), { recursive: true });
  return { gw: createMcpGateway({ baseDir }), baseDir };
}

describe('MCP stdio server: handleMessage', () => {
  test('initialize returns server info and tools capability', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, gw);
    expect(r).not.toBeNull();
    expect(r!.result.protocolVersion).toBeDefined();
    expect(r!.result.capabilities.tools).toBeDefined();
    expect(r!.result.serverInfo.name).toBe('safeloop');
  });

  test('tools/list returns four SafeLoop tools', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, gw);
    expect(r!.result.tools.length).toBe(4);
    const names = r!.result.tools.map((t: any) => t.name);
    expect(names).toContain('safeloop.checkCommand');
    expect(names).toContain('safeloop.runCommand');
    expect(names).toContain('safeloop.recordActivity');
    expect(names).toContain('safeloop.status');
  });

  test('tools/call checkCommand safe: allow, not executed', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'safeloop.checkCommand', arguments: { command: 'echo hello' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.decision).toBe('allow');
    expect(content.executed).toBe(false);
    expect(content.checkOnly).toBe(true);
  });

  test('tools/call checkCommand dangerous: deny, not executed', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'safeloop.checkCommand', arguments: { command: 'rm -rf .' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.decision).toBe('deny');
    expect(content.executed).toBe(false);
  });

  test('tools/call runCommand safe: allow, executed, output captured', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'safeloop.runCommand', arguments: { command: 'node -e "console.log(\'SAFELOOP_TRUE_MCP_OK\')"' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.decision).toBe('allow');
    expect(content.executed).toBe(true);
    expect(content.output).toContain('SAFELOOP_TRUE_MCP_OK');
  });

  test('tools/call runCommand dangerous: deny, not executed', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'safeloop.runCommand', arguments: { command: 'rm -rf .' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.decision).toBe('deny');
    expect(content.executed).toBe(false);
  });

  test('tools/call recordActivity: records event', () => {
    const { gw, baseDir } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'safeloop.recordActivity', arguments: { activityType: 'file.write', target: 'src/x.ts', summary: 'test' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.recorded).toBe(true);
    expect(content.eventId).toBeDefined();
    const events = readEvents({ baseDir });
    expect(events.some(e => e.id === content.eventId)).toBe(true);
  });

  test('tools/call status: includes transport stdio and boundary', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'safeloop.status', arguments: {} } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.transport).toBe('stdio');
    expect(content.enforcementBoundary).toContain('does not intercept');
  });

  test('unknown tool returns JSON-RPC error', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'safeloop.unknown', arguments: {} } }, gw);
    expect(r!.error).toBeDefined();
    expect(r!.error!.code).toBe(-32601);
  });

  test('unknown method returns JSON-RPC error', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 10, method: 'invalid/method' }, gw);
    expect(r!.error).toBeDefined();
    expect(r!.error!.code).toBe(-32601);
  });

  test('checkCommand never executes: SHOULD_NOT_RUN not in output', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'safeloop.checkCommand', arguments: { command: 'node -e "console.log(\'SHOULD_NOT_RUN\')"' } } }, gw);
    const content = JSON.parse(r!.result.content[0].text);
    expect(content.executed).toBe(false);
    expect(content.checkOnly).toBe(true);
    expect(JSON.stringify(content)).not.toContain('SHOULD_NOT_RUN');
  });

  test('notifications/initialized returns null (no response)', () => {
    const { gw } = makeTempGateway();
    const r = handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' } as any, gw);
    expect(r).toBeNull();
  });
});
