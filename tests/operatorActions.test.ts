import { startMonitorServer } from '../src/monitor/server';
import { readEvents } from '../src/eventStream';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import http from 'http';

describe('operator actions (server-only)', () => {
  test('invalid action returns 400, missing targetId returns 400, valid action persisted', async () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'safeloop-test-'));
    const serverInfo = await startMonitorServer({ baseDir: tmp, port: 0 } as any);
    const port = serverInfo.port;

    function post(body: any) {
      return new Promise<{ status: number; body: string }>((resolvep, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({ method: 'POST', port, path: '/api/operator/actions', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
          const chunks: any[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolvep({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    }

    // invalid action
    const invalid = await post({ action: 'invalid', targetId: 'x' });
    expect(invalid.status).toBe(400);

    // missing targetId
    const missingTarget = await post({ action: 'acknowledged' });
    expect(missingTarget.status).toBe(400);

    // valid action with optional fields
    const payload = { action: 'acknowledged', targetId: 't1', caseId: 'case-test', agent: 'op', targetType: 'approval', note: 'looks good' };
    const ok = await post(payload);
    expect([200, 201, 202].includes(ok.status)).toBeTruthy();

    // events file should contain the operator action
    const events = readEvents({ baseDir: tmp } as any);
    const found = events.find((e) => e.type === 'operator.action.recorded' && e.metadata && (e.metadata as any).targetId === 't1');
    expect(found).toBeDefined();

    // validate recorded event shape
    const ev: any = found;
    expect(ev.type).toBe('operator.action.recorded');
    expect(typeof ev.id).toBe('string');
    expect(ev.id.startsWith('operator:')).toBeTruthy();
    expect(ev.caseId).toBe('case-test');
    expect(ev.agentId).toBe('op');
    expect(ev.agentName).toBe('op');
    expect(typeof ev.summary === 'string' && ev.summary.includes('t1') && ev.summary.includes('acknowledged')).toBeTruthy();
    expect(ev.metadata).toBeDefined();
    expect(ev.metadata.source && ev.metadata.source.kind === 'operator-action').toBeTruthy();
    expect(ev.metadata.action === 'acknowledged').toBeTruthy();
    expect(ev.metadata.targetId === 't1').toBeTruthy();
    expect(ev.metadata.targetType === 'approval').toBeTruthy();
    expect(ev.metadata.note === 'looks good').toBeTruthy();

    await serverInfo.close();
    rmSync(tmp, { recursive: true, force: true });
  }, 20000);
});
