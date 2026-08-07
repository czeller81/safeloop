import * as http from 'http';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { createMonitorServer } from '../src/monitor';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-language-neutral-'));
}

function cleanup(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

function postJson(port: number, path: string, payload: unknown): Promise<{ statusCode: number; body: any }> {
  const data = JSON.stringify(payload);
  return new Promise((resolvePromise, reject) => {
    const req = http.request({
      method: 'POST',
      port,
      path,
      host: '127.0.0.1',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolvePromise({
          statusCode: res.statusCode ?? 0,
          body: body ? JSON.parse(body) : null,
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('language-neutral governance protocol', () => {
  it('ships parseable canonical JSON Schema files', () => {
    const schemaNames = [
      'governance-event.schema.json',
      'policy-request.schema.json',
      'policy-decision.schema.json',
      'approval.schema.json',
      'evidence.schema.json',
      'scenario-contract.schema.json',
      'memory-candidate.schema.json',
      'circuit-breaker-event.schema.json',
    ];

    for (const schemaName of schemaNames) {
      const schemaPath = resolve(process.cwd(), 'schemas', schemaName);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toContain(schemaName);
    }
  });

  it('evaluates policy requests through the CLI stdin JSON surface', () => {
    const completed = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', 'src/cli.ts', 'governance', 'evaluate', '--stdin'],
      {
        cwd: process.cwd(),
        input: JSON.stringify({
          agentId: 'python-agent',
          action: 'publish release to production',
          tool: 'deploy',
          target: 'production',
        }),
        encoding: 'utf8',
      },
    );
    const result = JSON.parse(completed.stdout);

    expect(completed.status).toBe(20);
    expect(result.disposition).toBe('REQUIRE_APPROVAL');
    expect(result.requiresApproval).toBe(true);
    expect(result.event.type).toBe('policy.failed');
  });

  it('evaluates policy requests through the monitor HTTP API', async () => {
    const baseDir = tempDir();
    const server = createMonitorServer({ baseDir });
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const response = await postJson(port, '/api/governance/evaluate', {
        input: {
          agentId: 'langgraph-agent',
          action: 'delete student records',
          target: 'student pii archive',
          context: {
            scenario: {
              scenarioId: 'k12-rag',
              forbiddenActions: ['delete student records'],
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.disposition).toBe('DENY');
      expect(response.body.allowed).toBe(false);
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      cleanup(baseDir);
    }
  });

  it('keeps dashboard compatibility while adding governance endpoints', async () => {
    const baseDir = tempDir();
    const server = createMonitorServer({ baseDir });
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const dashboard = await new Promise<{ statusCode: number; body: any }>((resolvePromise, reject) => {
        http.get(`http://127.0.0.1:${port}/api/dashboard`, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => resolvePromise({ statusCode: res.statusCode ?? 0, body: JSON.parse(body) }));
        }).on('error', reject);
      });

      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.body).toHaveProperty('events');
      expect(dashboard.body).toHaveProperty('viewModel');
      expect(dashboard.body).toHaveProperty('oversight');
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      cleanup(baseDir);
    }
  });
});
