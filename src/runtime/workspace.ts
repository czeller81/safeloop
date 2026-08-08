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

import { existsSync, lstatSync, readlinkSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, resolve, sep } from 'path';

export type WorkspaceRelation = 'inside' | 'outside' | 'unknown';

/** Maximum symlink hops before we declare the chain unresolvable. */
const MAX_SYMLINK_DEPTH = 32;

/**
 * Does this path exist as an entry, without following it?
 *
 * `existsSync` follows symlinks, so a *dangling* symlink reports false. That
 * is a security-relevant difference: a resolver that treats a dangling symlink
 * as absent will resolve the path lexically and classify it as in-workspace,
 * while `writeFileSync` happily follows the link and writes wherever it points.
 * That is the SL-RC1-HIGH-001 defect in a second guise.
 */
function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a path as far as the filesystem allows, following symlinks on the
 * deepest existing ancestor. A not-yet-created file inside a symlinked
 * directory still resolves through that symlink, and a dangling symlink is
 * followed to where it points rather than being mistaken for a plain file.
 *
 * Throws only on an unresolvable chain (loop or depth limit).
 */
function resolveStrict(target: string, cwd: string | undefined, depth: number): string {
  const absolute = isAbsolute(target) ? target : resolve(cwd ?? process.cwd(), target);
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(`symlink chain exceeded ${MAX_SYMLINK_DEPTH} hops`);
  }

  let existing = absolute;
  const trailing: string[] = [];
  // Walk up to the nearest entry that exists, not following symlinks.
  while (!entryExists(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    trailing.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }

  let real: string;
  try {
    real = realpathSync(existing);
  } catch {
    // realpathSync throws on a dangling symlink. Follow it by hand so the
    // final target is classified, not the link's own location.
    let link: string;
    try {
      if (!lstatSync(existing).isSymbolicLink()) return absolute;
      link = readlinkSync(existing);
    } catch {
      return absolute;
    }
    const next = isAbsolute(link) ? link : resolve(dirname(existing), link);
    real = resolveStrict(next, cwd, depth + 1);
  }

  return trailing.length ? resolve(real, ...trailing) : real;
}

export function resolveRealPath(target: string, cwd?: string): string {
  try {
    return resolveStrict(target, cwd, 0);
  } catch {
    // Lenient for classification callers; `verifyContainment` uses the strict
    // form so an unresolvable chain fails closed rather than being guessed.
    return isAbsolute(target) ? target : resolve(cwd ?? process.cwd(), target);
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

// --- Execution-time containment (SL-RC1-HIGH-001) --------------------------

/**
 * How the final path component should be treated when verifying containment.
 *
 * `follow` — the operation acts on whatever the path finally resolves to, so a
 * symlink at the final component must be followed and its target checked.
 * Reading or writing through a symlink that points outside the workspace is an
 * escape.
 *
 * `no_follow_final` — the operation acts on the entry itself rather than its
 * target. `rm` on a symlink removes the link; `rename` moves the link. For
 * these, following the final component and operating on the resolved target
 * would delete or move the wrong object — the very thing being defended
 * against. Only the ancestor chain is resolved.
 */
export type ContainmentMode = 'follow' | 'no_follow_final';

export interface ContainmentResult {
  relation: WorkspaceRelation;
  /**
   * False when containment could not be determined at all (unresolvable path
   * or workspace). Distinct from a known `unknown` relation caused simply by
   * no workspace being declared: the first is a verification failure and must
   * fail closed, the second is a legitimate state policy already handles.
   */
  verifiable: boolean;
  /**
   * The path the caller should operate on. For `follow` this is the fully
   * resolved real path, which is what removes the symlink-swap window: once
   * resolved, the operation no longer traverses the mutable component.
   */
  resolved: string;
  reason?: string;
}

/**
 * Re-verify, at execution time, where a path actually lands.
 *
 * A proposal-time classification is a statement about the filesystem as it was
 * *then*. Symlinks are mutable, so the same pathname can resolve somewhere else
 * by the time the side effect runs. This recomputes the answer immediately
 * before the operation and returns the resolved path to act on.
 *
 * Any failure to determine the answer yields `unknown`, which callers must
 * treat as a refusal rather than as permission.
 */
export function verifyContainment(
  target: string | undefined,
  workspace: string | undefined,
  cwd: string | undefined,
  mode: ContainmentMode = 'follow',
): ContainmentResult {
  if (!target) {
    return { relation: 'unknown', resolved: '', verifiable: false, reason: 'no target path supplied' };
  }

  const base = cwd || process.cwd();
  const absolute = isAbsolute(target) ? target : resolve(base, target);

  let resolved: string;
  try {
    if (mode === 'follow') {
      resolved = resolveStrict(absolute, base, 0);
    } else {
      // Resolve the ancestor chain but keep the final component literal, so a
      // swapped parent is still caught while the entry itself is not followed.
      const parent = resolveStrict(dirname(absolute), base, 0);
      resolved = resolve(parent, absolute.slice(dirname(absolute).length + 1) || '.');
    }
  } catch (error) {
    return {
      relation: 'unknown',
      resolved: absolute,
      verifiable: false,
      reason: `path could not be resolved: ${(error as Error).message}`,
    };
  }

  if (!workspace) {
    return { relation: 'unknown', resolved, verifiable: true, reason: 'no workspace is declared for this session' };
  }

  let realWorkspace: string;
  try {
    realWorkspace = resolveStrict(workspace, base, 0);
  } catch (error) {
    return {
      relation: 'unknown',
      resolved,
      verifiable: false,
      reason: `workspace could not be resolved: ${(error as Error).message}`,
    };
  }

  return { relation: contains(realWorkspace, resolved) ? 'inside' : 'outside', resolved, verifiable: true };
}
