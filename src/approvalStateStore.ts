import { existsSync, readFileSync } from 'fs';
import { resolveSafeloopPath, writeJsonFile } from './localStorage';
import type { SafeloopStorageOptions } from './localStorage';

export interface ApprovalStateRecord {
  tokenId: string;
  state: 'consumed' | 'revoked';
  recordedAt: string;
  expiresAt?: string;
  reason?: string;
}

export interface ApprovalStateStore {
  isConsumed(tokenId: string): boolean;
  consume(tokenId: string, record?: Omit<ApprovalStateRecord, 'tokenId' | 'state' | 'recordedAt'>): boolean;
  revoke(tokenId: string, reason: string, expiresAt?: string): boolean;
  count(): number;
}

interface ApprovalStateFile {
  version: 1;
  tokens: ApprovalStateRecord[];
}

function now(): string {
  return new Date().toISOString();
}

function activeRecord(record: ApprovalStateRecord): boolean {
  return !record.expiresAt || Date.parse(record.expiresAt) >= Date.now();
}

export function createInMemoryApprovalStateStore(initialRecords: ApprovalStateRecord[] = []): ApprovalStateStore {
  const records = new Map<string, ApprovalStateRecord>();
  for (const record of initialRecords) {
    records.set(record.tokenId, { ...record });
  }

  return {
    isConsumed(tokenId: string): boolean {
      const record = records.get(tokenId);
      return Boolean(record && activeRecord(record));
    },
    consume(tokenId: string, record = {}): boolean {
      if (this.isConsumed(tokenId)) return false;
      records.set(tokenId, {
        tokenId,
        state: 'consumed',
        recordedAt: now(),
        ...record,
      });
      return true;
    },
    revoke(tokenId: string, reason: string, expiresAt?: string): boolean {
      if (this.isConsumed(tokenId)) return false;
      records.set(tokenId, {
        tokenId,
        state: 'revoked',
        recordedAt: now(),
        reason,
        expiresAt,
      });
      return true;
    },
    count(): number {
      return Array.from(records.values()).filter(activeRecord).length;
    },
  };
}

export function createLocalApprovalStateStore(options: SafeloopStorageOptions = {}): ApprovalStateStore {
  const filePath = resolveSafeloopPath('approval-state.json', options);

  function readState(): ApprovalStateFile {
    if (!existsSync(filePath)) {
      return { version: 1, tokens: [] };
    }
    let parsed: ApprovalStateFile;
    try {
      const raw = readFileSync(filePath, 'utf8').trim();
      parsed = raw ? JSON.parse(raw) as ApprovalStateFile : { version: 1, tokens: [] };
    } catch {
      return {
        version: 1,
        tokens: [{
          tokenId: '*',
          state: 'revoked',
          recordedAt: new Date().toISOString(),
          reason: 'approval state store is corrupted; fail safe',
        }],
      };
    }
    return {
      version: 1,
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  }

  function writeState(state: ApprovalStateFile): void {
    writeJsonFile(filePath, {
      version: 1,
      tokens: state.tokens.filter(activeRecord),
    });
  }

  function findActive(tokenId: string): ApprovalStateRecord | undefined {
    return readState().tokens.find((record) => (record.tokenId === tokenId || record.tokenId === '*') && activeRecord(record));
  }

  function writeRecord(record: ApprovalStateRecord): boolean {
    const state = readState();
    if (state.tokens.some((existing) => existing.tokenId === '*' && activeRecord(existing))) {
      return false;
    }
    if (state.tokens.some((existing) => existing.tokenId === record.tokenId && activeRecord(existing))) {
      return false;
    }
    state.tokens.push(record);
    writeState(state);
    return true;
  }

  return {
    isConsumed(tokenId: string): boolean {
      return Boolean(findActive(tokenId));
    },
    consume(tokenId: string, record = {}): boolean {
      return writeRecord({
        tokenId,
        state: 'consumed',
        recordedAt: now(),
        ...record,
      });
    },
    revoke(tokenId: string, reason: string, expiresAt?: string): boolean {
      return writeRecord({
        tokenId,
        state: 'revoked',
        recordedAt: now(),
        reason,
        expiresAt,
      });
    },
    count(): number {
      return readState().tokens.filter(activeRecord).length;
    },
  };
}
