import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SUPPORTED_KEYWORDS,
  assertProtocol,
  protocolSchemaDirectory,
  protocolSchemas,
  validateProtocol,
} from '../src/runtime/schemaValidator';
import { PROTOCOL_VERSION } from '../src/runtime/protocol';
import { canonicalizeAction, fingerprintAction } from '../src/runtime/canonicalAction';

const registry = protocolSchemas();
const HASH = 'a'.repeat(64);
const NOW = '2026-08-07T12:00:00.000Z';

describe('protocol schema registry', () => {
  it('loads every schema in protocol/schemas', () => {
    expect(registry.names().length).toBeGreaterThanOrEqual(26);
    expect(registry.names()).toContain('action-proposal');
    expect(registry.names()).toContain('execution-permit');
    expect(registry.names()).toContain('memory-persistence-permit');
  });

  it('declares the protocol version on every schema', () => {
    for (const name of registry.names()) {
      expect(registry.get(name).protocolVersion).toBe(PROTOCOL_VERSION);
    }
  });

  it('only uses JSON Schema keywords this validator implements', () => {
    const unsupported = Array.from(registry.usedKeywords()).filter((key) => !SUPPORTED_KEYWORDS.has(key));
    expect(unsupported).toEqual([]);
  });

  it('resolves every $ref it declares', () => {
    const raw = registry.names()
      .map((name) => readFileSync(join(protocolSchemaDirectory(), `${name}.schema.json`), 'utf8'))
      .join('\n');
    const refs = Array.from(raw.matchAll(/"\$ref":\s*"([^"]+)"/g)).map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(() => registry.resolve(ref)).not.toThrow();
    }
  });

  it('is language-neutral: no schema references a TypeScript construct', () => {
    for (const name of registry.names()) {
      const raw = JSON.stringify(registry.get(name));
      expect(raw).not.toMatch(/typescript|\.ts"|interface /i);
    }
  });
});

describe('action-proposal schema', () => {
  it('accepts a minimal valid proposal', () => {
    expect(validateProtocol('action-proposal', { action_kind: 'shell', agent_id: 'a' }).valid).toBe(true);
  });

  it('rejects an unknown action kind', () => {
    const result = validateProtocol('action-proposal', { action_kind: 'kernel', agent_id: 'a' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('$.action_kind');
  });

  it('rejects a missing agent_id', () => {
    expect(validateProtocol('action-proposal', { action_kind: 'shell' }).valid).toBe(false);
  });

  it('rejects unknown properties so adapters cannot smuggle fields', () => {
    const result = validateProtocol('action-proposal', { action_kind: 'shell', agent_id: 'a', approved: true });
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain('additional property is not permitted');
  });
});

describe('canonical-action and action-fingerprint schemas', () => {
  it('validates real canonicalizer output', () => {
    const canonical = canonicalizeAction({ action_kind: 'git', operation: 'commit', agent_id: 'a' });
    expect(validateProtocol('canonical-action', canonical).valid).toBe(true);
  });

  it('validates real fingerprint output', () => {
    const fingerprint = fingerprintAction({ action_kind: 'git', operation: 'commit', agent_id: 'a' });
    expect(validateProtocol('action-fingerprint', fingerprint).valid).toBe(true);
  });

  it('rejects a fingerprint that is not lowercase sha256 hex', () => {
    const bad = { protocol_version: PROTOCOL_VERSION, fingerprint: 'ABC', algorithm: 'sha256', canonical_form: '{}' };
    expect(validateProtocol('action-fingerprint', bad).valid).toBe(false);
  });
});

describe('approval and permit schemas', () => {
  const token = {
    protocol_version: PROTOCOL_VERSION,
    approval_id: 'approval-1',
    action_fingerprint: HASH,
    agent_id: 'a',
    task_id: 't',
    session_id: 's',
    scenario_id: 'sc',
    tenant_id: 'tn',
    issued_at: NOW,
    expires_at: NOW,
    nonce: 'n'.repeat(32),
    policy_version: 'v1',
    approver: 'operator',
    signature: HASH,
  };

  it('accepts a well-formed bound approval token', () => {
    expect(validateProtocol('approval-token', token).valid).toBe(true);
  });

  it('rejects a token with a short nonce', () => {
    expect(validateProtocol('approval-token', { ...token, nonce: 'abc' }).valid).toBe(false);
  });

  it('rejects a token missing its signature', () => {
    const { signature, ...unsigned } = token;
    expect(validateProtocol('approval-token', unsigned).valid).toBe(false);
  });

  it('accepts a well-formed execution permit', () => {
    const permit = {
      protocol_version: PROTOCOL_VERSION,
      permit_id: 'permit-1',
      action_fingerprint: HASH,
      agent_id: 'a',
      task_id: 't',
      session_id: 's',
      scenario_id: 'sc',
      tenant_id: 'tn',
      disposition: 'ALLOW',
      issued_at: NOW,
      expires_at: NOW,
      nonce: 'n'.repeat(32),
      signature: HASH,
    };
    expect(validateProtocol('execution-permit', permit).valid).toBe(true);
    expect(validateProtocol('execution-permit', { ...permit, disposition: 'YOLO' }).valid).toBe(false);
  });
});

describe('memory schemas', () => {
  it('accepts a valid candidate and rejects confidence out of range', () => {
    const candidate = { memory_id: 'm1', memory_type: 'lesson', situation: 's', lesson: 'l', confidence: 0.9 };
    expect(validateProtocol('memory-candidate', candidate).valid).toBe(true);
    expect(validateProtocol('memory-candidate', { ...candidate, confidence: 1.5 }).valid).toBe(false);
  });

  it('rejects an unknown memory decision', () => {
    const decision = {
      protocol_version: PROTOCOL_VERSION,
      memory_decision_id: 'd1',
      decision: 'DEFINITELY',
      allowed: true,
      candidate_fingerprint: HASH,
      reasons: [],
      recommended_remediation: [],
      decided_at: NOW,
    };
    expect(validateProtocol('memory-decision', decision).valid).toBe(false);
  });
});

describe('managed path declaration schema', () => {
  it('accepts the three lawful states and rejects anything else', () => {
    for (const state of ['MANAGED', 'UNMANAGED', 'DISABLED']) {
      const declaration = { path: 'shell', state, consequential: true, certification_impact: true };
      expect(validateProtocol('managed-path-declaration', declaration).valid).toBe(true);
    }
    const bad = { path: 'shell', state: 'PARTIAL', consequential: true, certification_impact: true };
    expect(validateProtocol('managed-path-declaration', bad).valid).toBe(false);
  });
});

describe('assertProtocol', () => {
  it('throws a readable message naming the offending path', () => {
    expect(() => assertProtocol('action-proposal', { action_kind: 'shell' }))
      .toThrow(/action-proposal.*\$\.agent_id: required property is missing/);
  });

  it('stays silent on valid input', () => {
    expect(() => assertProtocol('action-proposal', { action_kind: 'shell', agent_id: 'a' })).not.toThrow();
  });
});
