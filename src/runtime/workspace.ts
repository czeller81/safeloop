/**
 * Workspace boundary and sensitive-path classification.
 *
 * Filesystem and git policy is workspace-relative: writing inside the declared
 * workspace is ordinary work, writing outside it is not. Getting containment
 * wrong is a real escape, so this module is deliberately conservative:
 *
 *   - containment is computed on resolved absolute paths, never on raw strings
 *   - `realpathSync` is applied to the nearest existing ancestor, so a symlink
 *     inside the workspace pointing outside it is classified as OUTSIDE
 *   - when containment cannot be determined, the answer is OUTSIDE
 *
 * "Unknown means outside" is the fail-closed direction: an unclassifiable path
 * gets the stricter policy, never the looser one.
 */

import { existsSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, resolve, sep } from 'path';

export type WorkspaceRelation = 'inside' | 'outside' | 'unknown';

/**
 * Resolve a path as far as the filesystem allows, following symlinks on the
 * deepest existing ancestor. A not-yet-created file inside a symlinked
 * directory still resolves through that symlink.
 */
export function resolveRealPath(target: string, cwd?: string): string {
  const absolute = isAbsolute(target) ? target : resolve(cwd ?? process.cwd(), target);

  let existing = absolute;
  const trailing: string[] = [];
  // Walk up to the nearest ancestor that exists.
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    trailing.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }

  try {
    const real = realpathSync(existing);
    return trailing.length ? resolve(real, ...trailing) : real;
  } catch {
    return absolute;
  }
}

/** True when `child` is the workspace itself or lies beneath it. */
function contains(parent: string, child: string): boolean {
  if (parent === child) return true;
  const withSeparator = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(withSeparator);
}

export function classifyWorkspaceRelation(
  target: string | undefined,
  workspace: string | undefined,
  cwd?: string,
): WorkspaceRelation {
  if (!target || !workspace) return 'unknown';
  try {
    const realTarget = resolveRealPath(target, cwd);
    const realWorkspace = resolveRealPath(workspace, cwd);
    return contains(realWorkspace, realTarget) ? 'inside' : 'outside';
  } catch {
    return 'unknown';
  }
}

/**
 * Credential and secret locations that are denied regardless of workspace.
 * A repository that happens to contain `.ssh/id_rsa` does not make reading it
 * ordinary work.
 */
const SENSITIVE_SEGMENTS: readonly string[] = [
  '/.ssh/',
  '/.aws/',
  '/.gnupg/',
  '/.kube/',
  '/.docker/config.json',
  '/.netrc',
  '/.npmrc',
  '/.pypirc',
  '/.git-credentials',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/passwd',
  '/proc/self/environ',
];

const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /(^|\/)\.env(\.[^/]+)?$/,
  /(^|\/)credentials(\.json|\.yaml|\.yml)?$/i,
  /(^|\/)secrets?(\.json|\.yaml|\.yml)$/i,
  /(^|\/)runtime-secret\.key$/,
  /(^|\/)runtime-credential\.json$/,
];

export function isSensitivePath(target: string | undefined, cwd?: string): boolean {
  if (!target) return false;
  const absolute = (() => {
    try {
      return resolveRealPath(target, cwd);
    } catch {
      return target;
    }
  })();
  const normalized = absolute.replace(/\\/g, '/');

  if (SENSITIVE_SEGMENTS.some((segment) => normalized.includes(segment))) return true;
  if (SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  // The user's own SafeLoop runtime state is always sensitive.
  const home = homedir().replace(/\\/g, '/');
  if (home && normalized.startsWith(`${home}/.safeloop`)) return true;

  return false;
}

/** Paths whose modification would change SafeLoop's own governance behaviour. */
export function isGovernanceConfigPath(target: string | undefined, cwd?: string): boolean {
  if (!target) return false;
  const normalized = (() => {
    try {
      return resolveRealPath(target, cwd).replace(/\\/g, '/');
    } catch {
      return target.replace(/\\/g, '/');
    }
  })();
  return /(^|\/)(safeloop\.policy\.(json|ya?ml|md)|safeloop\.config\.json|\.safeloop[^/]*\/)/.test(normalized)
    || /(^|\/)profiles?\/[^/]*\.profile\.json$/.test(normalized);
}
