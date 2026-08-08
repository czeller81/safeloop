/**
 * Atomic single-use state for approvals, execution permits, and memory
 * persistence permits.
 *
 * The v0.1 approval state store performed read → check → append → write on a
 * shared JSON file. Two concurrent redemptions could both observe "not
 * consumed" and both win. Since a permit authorizes a real side effect, that is
 * a double-spend.
 *
 * This store claims a token by *exclusively creating* a file:
 *
 *   openSync(path, 'wx')  →  EEXIST if it already exists
 *
 * Exclusive create is atomic in POSIX (O_CREAT|O_EXCL) and on Windows
 * (CREATE_NEW), and `openSync` does not yield to the event loop, so the winner
 * is unambiguous both across processes and within one.
 *
 * Failure posture: if the state directory cannot be read or written, the store
 * reports the claim as *not* granted. A runtime that cannot prove single use
 * must not authorize execution.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { runtimeStateDirectory } from './runtimeSecret';
import type { SafeloopStorageOptions } from '../localStorage';

export type ClaimState = 'consumed' | 'revoked';

export interface ClaimRecord {
  id: string;
  state: ClaimState;
  recorded_at: string;
  expires_at?: string;
  reason?: string;
}

export interface ClaimResult {
  granted: boolean;
  /** Set when the claim was refused. */
  conflict?: ClaimState | 'io_error';
  reason?: string;
}

export interface AtomicClaimStore {
  /** Atomically claim an id. Exactly one caller can win. */
  claim(id: string, record?: Partial<Omit<ClaimRecord, 'id' | 'state'>>): ClaimResult;
  /** Mark an id unusable without consuming it for execution. */
  revoke(id: string, reason: string): ClaimResult;
  /** Whether an id is already consumed or revoked. */
  isClaimed(id: string): boolean;
  read(id: string): ClaimRecord | undefined;
  count(): number;
  /** Remove expired records. Returns how many were dropped. */
  prune(now?: number): number;
}

/** Filenames must be filesystem-safe regardless of what an adapter sends. */
function claimFileName(id: string): string {
  return `${createHash('sha256').update(String(id), 'utf8').digest('hex')}.json`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(record: ClaimRecord, now: number): boolean {
  return Boolean(record.expires_at) && Date.parse(record.expires_at as string) < now;
}

export function createAtomicClaimStore(
  namespace: string,
  options: SafeloopStorageOptions = {},
): AtomicClaimStore {
  const directory = join(runtimeStateDirectory(options), 'claims', namespace);

  function ensureDirectory(): boolean {
    try {
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
      return true;
    } catch {
      return false;
    }
  }

  function readRecord(id: string): ClaimRecord | undefined {
    const path = join(directory, claimFileName(id));
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as ClaimRecord;
      if (!parsed || typeof parsed.state !== 'string') {
        // A corrupt record is treated as an active claim: fail closed.
        return { id, state: 'revoked', recorded_at: nowIso(), reason: 'claim record is corrupted; fail safe' };
      }
      return parsed;
    } catch {
      return { id, state: 'revoked', recorded_at: nowIso(), reason: 'claim record is unreadable; fail safe' };
    }
  }

  function write(id: string, state: ClaimState, extra: Partial<ClaimRecord>): ClaimResult {
    if (!ensureDirectory()) {
      return { granted: false, conflict: 'io_error', reason: 'runtime claim directory is unavailable' };
    }

    const existing = readRecord(id);
    if (existing && !isExpired(existing, Date.now())) {
      return { granted: false, conflict: existing.state, reason: `id already ${existing.state}` };
    }

    const record: ClaimRecord = {
      id,
      state,
      recorded_at: nowIso(),
      ...extra,
    };

    const path = join(directory, claimFileName(id));
    let handle: number;
    try {
      // Exclusive create: the atomic step. Only one caller can reach writeSync.
      handle = openSync(path, 'wx', 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        // Lost a genuine race, or an expired record still occupies the slot.
        const current = readRecord(id);
        if (current && isExpired(current, Date.now())) {
          try {
            unlinkSync(path);
          } catch {
            return { granted: false, conflict: 'io_error', reason: 'expired claim could not be reclaimed' };
          }
          return write(id, state, extra);
        }
        return { granted: false, conflict: current?.state ?? 'consumed', reason: 'id was claimed concurrently' };
      }
      return { granted: false, conflict: 'io_error', reason: `claim failed: ${code ?? 'unknown error'}` };
    }

    try {
      writeSync(handle, JSON.stringify(record));
      return { granted: true };
    } catch {
      return { granted: false, conflict: 'io_error', reason: 'claim record could not be written' };
    } finally {
      try {
        closeSync(handle);
      } catch {
        // Nothing further to do; the claim file already exists.
      }
    }
  }

  return {
    claim(id, record = {}): ClaimResult {
      return write(id, 'consumed', record);
    },
    revoke(id, reason): ClaimResult {
      return write(id, 'revoked', { reason });
    },
    isClaimed(id): boolean {
      const record = readRecord(id);
      return Boolean(record && !isExpired(record, Date.now()));
    },
    read(id): ClaimRecord | undefined {
      return readRecord(id);
    },
    count(): number {
      if (!existsSync(directory)) return 0;
      try {
        return readdirSync(directory).filter((name) => name.endsWith('.json')).length;
      } catch {
        return 0;
      }
    },
    prune(now = Date.now()): number {
      if (!existsSync(directory)) return 0;
      let dropped = 0;
      let names: string[];
      try {
        names = readdirSync(directory).filter((name) => name.endsWith('.json'));
      } catch {
        return 0;
      }
      for (const name of names) {
        const path = join(directory, name);
        try {
          const record = JSON.parse(readFileSync(path, 'utf8')) as ClaimRecord;
          if (isExpired(record, now)) {
            unlinkSync(path);
            dropped += 1;
          }
        } catch {
          // Corrupt records are retained: they fail closed, and deleting them
          // would turn a corruption into a replay opportunity.
        }
      }
      return dropped;
    },
  };
}
