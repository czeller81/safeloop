import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const CLI_PATH = resolve(__dirname, '..', 'src', 'cli.ts');

function waitForLine(stream: NodeJS.ReadableStream, timeoutMs = 15000): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout waiting for MCP stdout line'));
    }, timeoutMs);
    function onData(chunk: Buffer | string) {
      buffer += chunk.toString();
      const index = buffer.indexOf('\n');
      if (index >= 0) {
        const line = buffer.slice(0, index).trim();
        cleanup();
        resolveLine(line);
      }
    }
    function cleanup() {
      clearTimeout(timer);
      stream.off('data', onData);
    }
    stream.on('data', onData);
  });
}

function parseToolContent(response: any): any {
  return JSON.parse(response.result.content[0].text);
}

describe('safeloop mcp CLI integration', () => {
  test('mcp serve speaks newline JSON-RPC over stdout and logs to stderr', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-mcp-cli-'));
    const child = spawn(process.execPath, [
      '-r',
      'ts-node/register',
      CLI_PATH,
      'mcp',
      'serve',
      '--baseDir',
      baseDir,
    ], {
      cwd: resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      const initLine = await waitForLine(child.stdout);
      const init = JSON.parse(initLine);
      expect(init.result.serverInfo.name).toBe('safeloop');

      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      const toolsLine = await waitForLine(child.stdout);
      const tools = JSON.parse(toolsLine);
      expect(tools.result.tools.map((tool: any) => tool.name)).toContain('safeloop.status');

      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'safeloop.checkCommand', arguments: { command: 'rm -rf .' } },
      }) + '\n');
      const checkLine = await waitForLine(child.stdout);
      const check = parseToolContent(JSON.parse(checkLine));
      expect(check.decision).toBe('deny');
      expect(check.executed).toBe(false);

      expect(stderr).toContain('SafeLoop MCP stdio server started');
    } finally {
      child.stdin.end();
      child.kill();
    }
  }, 15000);
});
