import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolveSafeloopPath, writeJsonFile, type SafeloopStorageOptions } from './localStorage';

export interface LedgerSeal {
  version: 1;
  algorithm: 'sha256-chain-v1';
  sealedAt: string;
  eventFile: string;
  eventCount: number;
  malformedLineCount: number;
  skippedEmptyLineCount: number;
  rootHash: string;
}

export interface LedgerVerificationResult {
  ok: boolean;
  sealed: boolean;
  sealPath: string;
  eventPath: string;
  expectedRootHash?: string;
  actualRootHash: string;
  expectedEventCount?: number;
  actualEventCount: number;
  malformedLineCount: number;
  skippedEmptyLineCount: number;
  reason?: string;
}

interface LedgerDigest {
  rootHash: string;
  eventCount: number;
  malformedLineCount: number;
  skippedEmptyLineCount: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function digestLine(previousHash: string, line: string): string {
  return sha256(`${previousHash}\n${line}`);
}

function computeLedgerDigest(eventPath: string): LedgerDigest {
  if (!existsSync(eventPath)) {
    return {
      rootHash: sha256(''),
      eventCount: 0,
      malformedLineCount: 0,
      skippedEmptyLineCount: 0,
    };
  }

  const raw = readFileSync(eventPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let rootHash = sha256('');
  let eventCount = 0;
  let malformedLineCount = 0;
  let skippedEmptyLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      skippedEmptyLineCount += 1;
      continue;
    }

    try {
      JSON.parse(trimmed);
      rootHash = digestLine(rootHash, trimmed);
      eventCount += 1;
    } catch {
      malformedLineCount += 1;
    }
  }

  return { rootHash, eventCount, malformedLineCount, skippedEmptyLineCount };
}

function readSeal(sealPath: string): LedgerSeal | null {
  if (!existsSync(sealPath)) return null;
  try {
    return JSON.parse(readFileSync(sealPath, 'utf8')) as LedgerSeal;
  } catch {
    return null;
  }
}

export function resolveLedgerSealPath(options: SafeloopStorageOptions = {}): string {
  return resolveSafeloopPath('ledger.seal.json', options);
}

export function sealLedger(options: SafeloopStorageOptions = {}): LedgerSeal {
  const eventPath = resolveSafeloopPath('events.jsonl', options);
  const sealPath = resolveLedgerSealPath(options);
  const digest = computeLedgerDigest(eventPath);
  const seal: LedgerSeal = {
    version: 1,
    algorithm: 'sha256-chain-v1',
    sealedAt: new Date().toISOString(),
    eventFile: eventPath,
    eventCount: digest.eventCount,
    malformedLineCount: digest.malformedLineCount,
    skippedEmptyLineCount: digest.skippedEmptyLineCount,
    rootHash: digest.rootHash,
  };
  writeJsonFile(sealPath, seal);
  return seal;
}

export function verifyLedger(options: SafeloopStorageOptions = {}): LedgerVerificationResult {
  const eventPath = resolveSafeloopPath('events.jsonl', options);
  const sealPath = resolveLedgerSealPath(options);
  const digest = computeLedgerDigest(eventPath);
  const seal = readSeal(sealPath);

  if (!seal) {
    return {
      ok: false,
      sealed: false,
      sealPath,
      eventPath,
      actualRootHash: digest.rootHash,
      actualEventCount: digest.eventCount,
      malformedLineCount: digest.malformedLineCount,
      skippedEmptyLineCount: digest.skippedEmptyLineCount,
      reason: 'Ledger has not been sealed.',
    };
  }

  const hashMatches = seal.rootHash === digest.rootHash;
  const countMatches = seal.eventCount === digest.eventCount;
  return {
    ok: hashMatches && countMatches,
    sealed: true,
    sealPath,
    eventPath,
    expectedRootHash: seal.rootHash,
    actualRootHash: digest.rootHash,
    expectedEventCount: seal.eventCount,
    actualEventCount: digest.eventCount,
    malformedLineCount: digest.malformedLineCount,
    skippedEmptyLineCount: digest.skippedEmptyLineCount,
    reason: hashMatches && countMatches ? undefined : 'Ledger content does not match the current seal.',
  };
}
