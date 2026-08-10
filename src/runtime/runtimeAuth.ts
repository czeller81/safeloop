/**
 * Local runtime authentication.
 *
 * "Local" is not "unauthenticated". Any process on the host can reach
 * 127.0.0.1, so a governance runtime that skipped authentication would let an
 * unrelated process mint execution permits.
 *
 * Three layers, deliberately distinct:
 *
 *   runtime credential — may you talk to this daemon at all? Written 0600 to
 *     the runtime state directory; possession of the file is the trust
 *     boundary, exactly like a Docker socket. This is what an agent holds.
 *
 *   session credential — which session are you acting inside? Issued by
 *     `startSession`, bound to one session, and required for every call that
 *     carries identity. A caller holding the runtime credential still cannot
 *     act inside a session it did not start.
 *
 *   operator credential — are you the human this action is being held for?
 *     Required by the approval routes and by nothing else.
 *
 * SL-RC3-CRIT-002: the third layer exists because the first two did not
 * separate the agent from its approver. An agent must hold the runtime
 * credential to propose anything at all, and the approval route accepted that
 * same credential, so an agent could satisfy the human-approval control itself:
 * propose, grant, redeem, execute — no human anywhere. Every execution-context
 * check downstream passed honestly, because nothing had been substituted. The
 * approver field was recorded but never checked, so the ledger even named
 * whoever the agent said had approved.
 *
 * The operator credential is therefore a *different secret in a different file*
 * that the agent has no reason to hold. It also outlives the daemon: it is a
 * standing human credential, not a per-process connection detail, so it is not
 * written into the connection file the agent reads and is not deleted on stop.
 *
 * No credential here is ever written to a log, an event, or a protocol payload.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';
import { runtimeStateDirectory } from './runtimeSecret';
import { PROTOCOL_VERSION } from './protocol';
import type { SafeloopStorageOptions } from '../localStorage';

export interface RuntimeConnectionFile {
  protocol_version: string;
  runtime_version: string;
  pid: number;
  started_at: string;
  host: string;
  port: number | null;
  socket_path: string | null;
  /** Bearer credential for the daemon's HTTP and socket transports. */
  credential: string;
}

export function connectionFilePath(options: SafeloopStorageOptions = {}): string {
  return join(runtimeStateDirectory(options), 'runtime-credential.json');
}

export function generateRuntimeCredential(): string {
  return randomBytes(32).toString('hex');
}

export function writeConnectionFile(file: RuntimeConnectionFile, options: SafeloopStorageOptions = {}): string {
  const path = connectionFilePath(options);
  writeFileSync(path, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Filesystems without POSIX modes cannot narrow this further.
  }
  return path;
}

export function readConnectionFile(options: SafeloopStorageOptions = {}): RuntimeConnectionFile | undefined {
  const path = connectionFilePath(options);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RuntimeConnectionFile;
  } catch {
    return undefined;
  }
}

export function removeConnectionFile(options: SafeloopStorageOptions = {}): void {
  rmSync(connectionFilePath(options), { force: true });
}

// --- Operator credential (SL-RC3-CRIT-002) ---------------------------------

export interface OperatorCredentialFile {
  protocol_version: string;
  created_at: string;
  /** Bearer credential required by the approval routes. */
  credential: string;
}

export function operatorCredentialFilePath(options: SafeloopStorageOptions = {}): string {
  return join(runtimeStateDirectory(options), 'operator-credential.json');
}

export function generateOperatorCredential(): string {
  return randomBytes(32).toString('hex');
}

export function readOperatorCredentialFile(options: SafeloopStorageOptions = {}): OperatorCredentialFile | undefined {
  const path = operatorCredentialFilePath(options);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as OperatorCredentialFile;
    return typeof parsed?.credential === 'string' && parsed.credential ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the operator credential, minting and persisting one on first use.
 *
 * Created rather than demanded so that starting a daemon never fails for want
 * of a file the operator has not been told about yet — but the value is only
 * ever readable from a 0600 file the agent has no reason to open, so creating
 * it grants nobody anything. It persists across restarts: an operator who has
 * put this in a password manager should not find it rotated by a daemon bounce.
 */
export function loadOperatorCredential(options: SafeloopStorageOptions = {}): string {
  const existing = readOperatorCredentialFile(options);
  if (existing) return existing.credential;

  const file: OperatorCredentialFile = {
    protocol_version: PROTOCOL_VERSION,
    created_at: new Date().toISOString(),
    credential: generateOperatorCredential(),
  };
  const path = operatorCredentialFilePath(options);
  writeFileSync(path, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Filesystems without POSIX modes cannot narrow this further.
  }
  return file.credential;
}

/** Constant-time credential comparison. */
export function credentialsMatch(expected: string, provided: string | undefined): boolean {
  if (!provided || expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  } catch {
    return false;
  }
}

/** Extract a bearer credential from request headers, tolerating case variants. */
export function bearerFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : undefined;
}

/** Redact anything credential-shaped before it can reach a log line. */
export function scrubCredentials(text: string): string {
  return text.replace(/\b[0-9a-f]{64}\b/g, '[REDACTED credential]');
}
