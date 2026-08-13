import { createHash } from 'crypto';
import { existsSync, openSync, readSync, statSync, closeSync } from 'fs';

export type ExecutionVerificationStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_VERIFIABLE' | 'FAILED';

export interface ObservedFileState {
  path: string;
  exists: boolean;
  object_type: 'file' | 'directory' | 'other' | 'absent' | 'unknown';
  size_bytes?: number;
  sha256?: string;
  line_count?: number;
  hash_capped?: boolean;
  hash_cap_bytes?: number;
  hash_error?: string;
}

export interface ExecutionProofRecord {
  execution_id?: string;
  permit_id?: string;
  action_fingerprint?: string;
  executor: string;
  operation?: string;
  started_at?: string;
  completed_at?: string;
  before?: unknown;
  after?: unknown;
  result?: Record<string, unknown>;
  evidence_ids?: string[];
  artifact_ids?: string[];
  verification_status: ExecutionVerificationStatus;
  verification_summary: string;
  verification_scope: string;
}

export const DEFAULT_FILE_HASH_LIMIT_BYTES = 64 * 1024 * 1024;

export function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value ?? null));
}

export function observeFileState(path: string, maxHashBytes = DEFAULT_FILE_HASH_LIMIT_BYTES): ObservedFileState {
  try {
    if (!existsSync(path)) return { path, exists: false, object_type: 'absent' };
    const stats = statSync(path);
    if (stats.isDirectory()) return { path, exists: true, object_type: 'directory', size_bytes: stats.size };
    if (!stats.isFile()) return { path, exists: true, object_type: 'other', size_bytes: stats.size };
    const state: ObservedFileState = { path, exists: true, object_type: 'file', size_bytes: stats.size };
    if (stats.size > maxHashBytes) {
      return { ...state, hash_capped: true, hash_cap_bytes: maxHashBytes };
    }

    const hash = createHash('sha256');
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead = 0;
      let lineCount = 0;
      do {
        bytesRead = readSync(fd, buffer, 0, buffer.length, null);
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
          for (let index = 0; index < bytesRead; index += 1) {
            if (buffer[index] === 10) lineCount += 1;
          }
        }
      } while (bytesRead > 0);
      return { ...state, sha256: `sha256:${hash.digest('hex')}`, line_count: lineCount };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    return {
      path,
      exists: false,
      object_type: 'unknown',
      hash_error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function filesystemDeltaSummary(before: ObservedFileState, after: ObservedFileState): string {
  if (!before.exists && after.exists) return `file created; size: ${after.size_bytes ?? 'unknown'} bytes`;
  if (before.exists && !after.exists) return 'file deleted; after state absent';
  const beforeSize = before.size_bytes ?? 'unknown';
  const afterSize = after.size_bytes ?? 'unknown';
  const hashChanged = before.sha256 && after.sha256 ? before.sha256 !== after.sha256 : undefined;
  return `file modified; size: ${beforeSize} -> ${afterSize} bytes${hashChanged === undefined ? '' : hashChanged ? '; hash changed' : '; hash unchanged'}`;
}

export function attachExecutionProof(detail: Record<string, unknown> | undefined, proof: ExecutionProofRecord): Record<string, unknown> {
  return { ...(detail ?? {}), execution_proof: proof };
}

export function extractExecutionProof(detail: Record<string, unknown> | undefined): ExecutionProofRecord | undefined {
  const proof = detail?.execution_proof;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return undefined;
  const record = proof as ExecutionProofRecord;
  return typeof record.executor === 'string' && typeof record.verification_status === 'string' ? record : undefined;
}

export function proofEvidenceContent(proof: ExecutionProofRecord): string {
  return JSON.stringify(proof);
}
