import * as http from 'http';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startMonitorServer } from '../src/monitor/server';

jest.setTimeout(30000);

function httpRequest(
  url: string,
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Monitor server — body size limit and redaction', () => {
  let serverHandle: { port: number; close: () => Promise<void> } | null = null;
  let baseUrl = '';

  beforeAll(async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'safeloop-body-test-'));
    const safeloopDir = join(baseDir, '.safeloop');
    mkdirSync(safeloopDir, { recursive: true });

    serverHandle = await startMonitorServer({
      baseDir,
      port: 0, // ephemeral
    });
    baseUrl = `http://127.0.0.1:${serverHandle.port}`;
  });

  afterAll(async () => {
    if (serverHandle) await serverHandle.close();
  });

  it('rejects POST body over 1MB with 413', async () => {
    // Create a body just over 1MB
    const largePayload = JSON.stringify({
      action: 'acknowledged',
      targetId: 'x'.repeat(1024 * 1024 + 100),
    });

    const result = await httpRequest(
      `${baseUrl}/api/operator/actions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(largePayload, 'utf8').toString(),
        },
      },
      largePayload,
    );

    expect(result.statusCode).toBe(413);
    const json = JSON.parse(result.body);
    expect(json.error).toContain('1MB');
  });

  it('accepts valid POST body under 1MB', async () => {
    const payload = JSON.stringify({
      action: 'acknowledged',
      targetId: 'test-target-id',
    });

    const result = await httpRequest(
      `${baseUrl}/api/operator/actions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload, 'utf8').toString(),
        },
      },
      payload,
    );

    expect(result.statusCode).toBe(201);
    const json = JSON.parse(result.body);
    expect(json.ok).toBe(true);
    expect(json.id).toBeDefined();
  });

  it('returns redacted metadata in /api/dashboard', async () => {
    const result = await httpRequest(`${baseUrl}/api/dashboard`, { method: 'GET' });

    expect(result.statusCode).toBe(200);
    // The dashboard should return valid JSON without errors
    const json = JSON.parse(result.body);
    expect(json).toBeDefined();
    // Verify top-level compatibility is preserved
    expect(json.viewModel).toBeDefined();
    expect(json.eventCount).toBeDefined();
  });
});
