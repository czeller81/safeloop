import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendEvent } from '../src/eventStream';
import { createAuditExportBundle, writeAuditExportBundle } from '../src/auditExport';
import { initializeSafeloopPolicyConfig } from '../src/policyConfig';

function makeBaseDir(): string {
  return mkdtempSync(join(tmpdir(), 'safeloop-audit-export-'));
}

describe('audit export bundle', () => {
  test('creates local redacted bundle with policy, ledger, summary, and events', () => {
    const baseDir = makeBaseDir();
    initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });
    appendEvent({
      id: 'evt-secret',
      type: 'decision.made',
      agentId: 'agent',
      caseId: 'case-1',
      summary: 'Decision recorded',
      metadata: {
        decision: 'allow',
        apiKey: 'should-not-leak',
      },
    }, { baseDir });
    appendEvent({
      id: 'evt-approval',
      type: 'approval.requested',
      agentId: 'agent',
      caseId: 'case-1',
      summary: 'Review export',
      metadata: { approvalId: 'ap-1' },
    }, { baseDir });

    const bundle = createAuditExportBundle({ baseDir, host: 'generic' });

    expect(bundle.localOnly).toBe(true);
    expect(bundle.policy.policy.profile).toBe('k12-offline-rag');
    expect(bundle.summary.eventCount).toBe(2);
    expect(bundle.summary.decisionCount).toBe(1);
    expect(bundle.summary.approvalCount).toBe(1);
    expect(JSON.stringify(bundle)).not.toContain('should-not-leak');
    expect(JSON.stringify(bundle)).toContain('[redacted]');
  });

  test('writes audit bundle to requested path', () => {
    const baseDir = makeBaseDir();
    initializeSafeloopPolicyConfig({ baseDir, profile: 'k12-offline-rag' });
    const outPath = join(baseDir, 'exports', 'audit.json');

    const result = writeAuditExportBundle({ baseDir, outPath, host: 'generic' });

    expect(result.path).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(JSON.parse(readFileSync(outPath, 'utf8')).version).toBe(1);
  });
});
