import * as http from 'http';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startMonitorServer } from '../src/monitor/server';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-http-auth-'));
}

function postJson(port: number, path: string, payload: unknown, token?: string): Promise<{ status: number; body: any; requestId?: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null, requestId: res.headers['x-request-id']?.toString() });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const policyPayload = {
  input: {
    agentId: 'agent-1',
    tenantId: 'tenant-alpha',
    action: 'read local status',
    tool: 'status',
  },
};

describe('HTTP governance authentication', () => {
  let handle: { port: number; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  test('development local mode allows governance requests without credentials', async () => {
    handle = await startMonitorServer({ port: 0, baseDir: makeTempDir() });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload);
    expect(response.status).toBe(200);
    expect(response.body.disposition).toBe('ALLOW');
  });

  test('secured mode accepts authenticated governance requests', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: { enabled: true, bearerToken: 'secret', allowedTenants: ['tenant-alpha'] },
    });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload, 'secret');
    expect(response.status).toBe(200);
    expect(response.body.disposition).toBe('ALLOW');
  });

  test('secured mode rejects missing credentials', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: { enabled: true, bearerToken: 'secret' },
    });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload);
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('unauthorized');
  });

  test('secured mode rejects invalid credentials', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: { enabled: true, bearerToken: 'secret' },
    });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload, 'wrong');
    expect(response.status).toBe(401);
  });

  test('secured mode rejects wrong tenant', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: { enabled: true, bearerToken: 'secret', allowedTenants: ['tenant-beta'] },
    });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload, 'secret');
    expect(response.status).toBe(403);
  });

  test('secured memory endpoint uses the same authentication boundary', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: { enabled: true, bearerToken: 'secret', allowedTenants: ['tenant-alpha'] },
    });
    const response = await postJson(handle.port, '/api/governance/memory', {
      memory: {
        memory_id: 'mem-1',
        memory_type: 'lesson',
        situation: 'task completed',
        lesson: 'retry after transient failure',
        confidence: 0.9,
        evidence: ['artifact-1'],
        tenant: 'tenant-alpha',
      },
    }, 'secret');
    expect(response.status).toBe(200);
    expect(response.body.allowed).toBe(true);
  });

  test('secured mode supports an extensible rate-limit hook', async () => {
    handle = await startMonitorServer({
      port: 0,
      baseDir: makeTempDir(),
      governanceAuth: {
        enabled: true,
        bearerToken: 'secret',
        rateLimit: () => 'too many governance requests',
      },
    });
    const response = await postJson(handle.port, '/api/governance/evaluate', policyPayload, 'secret');
    expect(response.status).toBe(429);
    expect(response.body.error).toBe('too many governance requests');
  });

  test('governance endpoint rejects malformed policy payloads safely', async () => {
    handle = await startMonitorServer({ port: 0, baseDir: makeTempDir() });
    const response = await postJson(handle.port, '/api/governance/evaluate', { action: '' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('agentId');
    expect(response.requestId).toBeDefined();
  });

  test('memory endpoint rejects malformed memory payloads safely', async () => {
    handle = await startMonitorServer({ port: 0, baseDir: makeTempDir() });
    const response = await postJson(handle.port, '/api/governance/memory', { memory: { memory_id: 'mem-1' } });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('situation');
  });
});
