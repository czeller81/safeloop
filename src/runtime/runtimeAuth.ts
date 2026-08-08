/**
 * Local runtime authentication.
 *
 * "Local" is not "unauthenticated". Any process on the host can reach
 * 127.0.0.1, so a governance runtime that skipped authentication would let an
 * unrelated process mint execution permits.
 *
 * Two layers, deliberately distinct:
 *
 *   runtime credential — may you talk to this daemon at all? Written 0600 to
 *     the runtime state directory; possession of the file is the trust
 *     boundary, exactly like a Docker socket.
 *
 *   session credential — which session are you acting inside? Issued by
 *     `startSession`, bound to one session, and required for every call that
 *     carries identity. A caller holding the runtime credential still cannot
 *     act inside a session it did not start.
 *
 * Neither credential is ever written to a log, an event, or a protocol payload.
 */

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';
import { runtimeStateDirectory } from './runtimeSecret';
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
