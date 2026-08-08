/**
 * SafeLoop runtime signing secret.
 *
 * One secret per runtime state directory. It signs approval tokens, execution
 * permits, and memory persistence permits, so possession of it is equivalent to
 * the ability to authorize managed execution.
 *
 * Rules enforced here:
 *   - generated, never hardcoded and never defaulted to a shared constant
 *   - stored 0600 in the runtime state directory, which is created 0700
 *   - never returned in any protocol payload, event, log line, or error message
 *   - callers receive it only to feed HMAC; `describeSecret()` is what is safe
 *     to print
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { dirname, join } from 'path';
import { resolveSafeloopPath } from '../localStorage';
import type { SafeloopStorageOptions } from '../localStorage';

const SECRET_BYTES = 32;

export function runtimeStateDirectory(options: SafeloopStorageOptions = {}): string {
  const directory = dirname(resolveSafeloopPath('runtime/placeholder', options));
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return directory;
}

function secretPath(options: SafeloopStorageOptions = {}): string {
  return join(runtimeStateDirectory(options), 'runtime-secret.key');
}

/**
 * Load the runtime secret, generating it on first use.
 *
 * An env override exists for multi-process runtimes that must share a secret
 * without sharing a filesystem. It is read from the environment and never
 * written back to disk.
 */
export function loadRuntimeSecret(options: SafeloopStorageOptions = {}): string {
  const override = process.env.SAFELOOP_RUNTIME_SECRET;
  if (override && override.length >= 32) return override;

  const path = secretPath(options);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= SECRET_BYTES * 2) return existing;
  }

  const secret = randomBytes(SECRET_BYTES).toString('hex');
  writeFileSync(path, secret, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Filesystems without POSIX modes (some Windows mounts) cannot narrow this.
  }
  return secret;
}

/** Rotate the secret. Every outstanding token and permit becomes unverifiable. */
export function rotateRuntimeSecret(options: SafeloopStorageOptions = {}): string {
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  writeFileSync(secretPath(options), secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

/**
 * A non-reversible identifier for the active secret. Safe to log, print in
 * status output, and embed in evidence: it proves which secret signed a token
 * without revealing the secret.
 */
export function describeSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16)}`;
}

/** Constant-time comparison of two hex signatures of equal expected length. */
export function signaturesMatch(expected: string, actual: string): boolean {
  if (typeof actual !== 'string' || expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
  } catch {
    return false;
  }
}
