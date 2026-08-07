import * as http from 'http';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { startMonitorServer } from '../src/monitor/server';

function readFirstSseEvent(url: string, eventName: string): Promise<{ statusCode: number; data: any; contentType?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const records = buffer.split('\n\n');
        for (const record of records) {
          if (!record.includes(`event: ${eventName}`)) continue;
          const dataLine = record.split(/\r?\n/).find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          req.destroy();
          resolve({
            statusCode: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            data: JSON.parse(dataLine.slice('data: '.length)),
          });
          return;
        }
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timed out waiting for SSE event'));
    });
    req.on('error', (error: any) => {
      if (error?.code === 'ECONNRESET') return;
      reject(error);
    });
  });
}

describe('monitor SSE stream', () => {
  let serverHandle: { port: number; close: () => Promise<void> } | null = null;
  let baseDir = '';
  const port = 38893;

  beforeAll(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'safeloop-sse-'));
    appendEvent({
      id: 'sse-evt-1',
      type: 'task.started',
      agentId: 'agent',
      caseId: 'case-sse',
      summary: 'SSE event',
    }, { baseDir });
    serverHandle = await startMonitorServer({ port, baseDir });
  });

  afterAll(async () => {
    if (serverHandle) await serverHandle.close();
  });

  test('streams dashboard payload without breaking /api/dashboard compatibility', async () => {
    const result = await readFirstSseEvent(`http://127.0.0.1:${port}/api/events/stream`, 'dashboard');

    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain('text/event-stream');
    expect(result.data).toHaveProperty('events');
    expect(result.data).toHaveProperty('viewModel');
    expect(result.data.eventCount).toBe(1);
    expect(result.data.events[0].id).toBe('sse-evt-1');
  });
});
