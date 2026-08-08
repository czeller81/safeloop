/**
 * Execution-context binding.
 *
 * RC1 bound authorization to a path *string*. RC2 showed that is not enough for
 * the filesystem, because mutable symlink state can make the same string name a
 * different object by execution time. RC2's narrow review then reproduced the
 * identical defect in two more executors:
 *
 *   shell — a command authorized with cwd inside the workspace ran with cwd
 *           pointing outside it after a swap
 *   git   — a commit authorized for repository A landed in repository B
 *
 * The common invariant, and the one this module exists to enforce:
 *
 *   THE ACTION THAT EXECUTES MUST STILL BE THE SECURITY-SIGNIFICANT ACTION
 *   THAT WAS AUTHORIZED.
 *
 * A cryptographically valid permit is insufficient if mutable host state can
 * redirect where its side effect lands.
 *
 * The facts computed here are resolved at authorization time, signed into the
 * permit, and re-resolved immediately before the side effect. They are
 * deliberately kept out of the action fingerprint, which must stay
 * deterministic and reproducible off-host.
 */

import { spawnSync } from 'child_process';
import { statSync } from 'fs';
import { resolveRealPath, resolveRealPathStrict } from './workspace';

/** How long a git identity probe may take before we treat it as unverifiable. */
const GIT_PROBE_TIMEOUT_MS = 5_000;

export type ExecutionContextReason =
  /** The resolved working directory is not the one that was authorized. */
  | 'cwd_context_changed'
  /** The git repository reached from cwd is not the one that was authorized. */
  | 'repository_context_changed'
  /** The workspace relation or root changed (RC2 filesystem invariant). */
  | 'workspace_relation_changed'
  /** Context could not be determined at all; fail closed. */
  | 'execution_context_verification_failed'
  | 'workspace_verification_failed';

/**
 * Raised when the security-significant execution context no longer matches the
 * context the permit was issued against. Surfaces as a REJECTED execution and
 * never as a completed side effect.
 */
export class ExecutionContextError extends Error {
  constructor(
    message: string,
    public readonly reason: ExecutionContextReason,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ExecutionContextError';
  }
}

/**
 * Resolve a working directory to the real object it names.
 *
 * Returns undefined when no cwd is declared — there is then no context to bind
 * and nothing to verify. Throws only when a declared cwd cannot be resolved,
 * which callers treat as fail-closed.
 */
export function resolveExecutionCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;

  let resolved: string;
  try {
    // Strict: an unresolvable chain (loop, depth limit) must fail closed rather
    // than fall back to a lexical guess that would compare equal to the
    // authorized value and let a broken directory through to spawn.
    resolved = resolveRealPathStrict(cwd);
  } catch (error) {
    throw new ExecutionContextError(
      'the declared working directory could not be resolved',
      'execution_context_verification_failed',
      { cwd, reason: (error as Error).message },
    );
  }

  // The directory must still be a directory. Letting a vanished or replaced
  // cwd reach `spawn` would surface as an opaque process error rather than a
  // governance refusal, and the distinction matters to an operator.
  try {
    if (!statSync(resolved).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch (error) {
    throw new ExecutionContextError(
      'the working directory does not exist or is not a directory',
      'execution_context_verification_failed',
      { cwd, resolved, reason: (error as Error).message },
    );
  }

  return resolved;
}

/**
 * Identify the git repository reachable from a directory.
 *
 * Uses git's own plumbing rather than guessing at `.git`, so worktrees, `.git`
 * files, and `GIT_DIR` redirection all resolve the way git itself resolves
 * them. The absolute git directory is the security-relevant identity: two
 * different working trees sharing one git directory are the same repository,
 * and the same path reached through a swapped symlink is a different one.
 *
 * Returns null when the directory is not a repository. That is a legitimate
 * state (a shell action in a plain directory), not a failure.
 */
export function resolveRepositoryIdentity(cwd: string | undefined): string | null {
  if (!cwd) return null;

  const probe = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd,
    encoding: 'utf8',
    timeout: GIT_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  if (probe.error || probe.status !== 0) return null;

  const gitDir = (probe.stdout || '').trim();
  if (!gitDir) return null;

  // Resolve so a symlinked git directory cannot masquerade as a different one.
  return resolveRealPath(gitDir);
}

export interface AuthorizedExecutionContext {
  execution_cwd?: string;
  repository_identity?: string;
}

/**
 * Compute the execution-context facts to sign into a permit.
 *
 * Repository identity is only probed for git actions: running `git rev-parse`
 * for every shell command would add a subprocess to the hot path for a fact
 * that shell authorization does not depend on.
 */
export function captureExecutionContext(
  actionKind: string,
  cwd: string | undefined,
): AuthorizedExecutionContext {
  const context: AuthorizedExecutionContext = {};
  try {
    context.execution_cwd = resolveExecutionCwd(cwd);
  } catch {
    // Leave it unset. The executor fails closed on a missing authorized fact
    // when a cwd is declared, so an unresolvable cwd cannot become permission.
    return context;
  }

  if (actionKind === 'git') {
    const repository = resolveRepositoryIdentity(context.execution_cwd ?? cwd);
    if (repository) context.repository_identity = repository;
  }
  return context;
}

/**
 * Re-verify the working directory immediately before the side effect.
 *
 * Called by every executor that runs *in* a directory. The rule is equality
 * with the authorized value, not membership of a workspace: an action
 * legitimately authorized to run outside the workspace still runs, provided it
 * runs where it was authorized to run.
 */
export function verifyExecutionCwd(
  declaredCwd: string | undefined,
  authorizedCwd: string | undefined,
): string | undefined {
  if (!declaredCwd) {
    // No directory was part of the authorization, so there is nothing that can
    // have been redirected.
    return undefined;
  }

  if (!authorizedCwd) {
    throw new ExecutionContextError(
      'the permit carries no authorized working directory to verify against',
      'execution_context_verification_failed',
      { declared_cwd: declaredCwd },
    );
  }

  let current: string | undefined;
  try {
    current = resolveExecutionCwd(declaredCwd);
  } catch (error) {
    throw new ExecutionContextError(
      'the working directory could not be resolved at execution time',
      'execution_context_verification_failed',
      { declared_cwd: declaredCwd, reason: (error as Error).message },
    );
  }

  if (current !== authorizedCwd) {
    throw new ExecutionContextError(
      'the working directory now resolves somewhere other than where the permit was issued',
      'cwd_context_changed',
      { authorized_cwd: authorizedCwd, execution_cwd: current },
    );
  }

  // Return the resolved directory so the caller spawns against the real path
  // rather than re-traversing the mutable one.
  return current;
}

/**
 * Re-verify git repository identity immediately before a consequential
 * operation. An approval for repository A must never act on repository B.
 */
export function verifyRepositoryIdentity(
  cwd: string | undefined,
  authorizedRepository: string | undefined,
): void {
  if (!authorizedRepository) {
    throw new ExecutionContextError(
      'the permit carries no authorized repository identity to verify against',
      'execution_context_verification_failed',
      { cwd },
    );
  }

  const current = resolveRepositoryIdentity(cwd);
  if (!current) {
    throw new ExecutionContextError(
      'no git repository could be identified at execution time',
      'execution_context_verification_failed',
      { authorized_repository: authorizedRepository },
    );
  }

  if (current !== authorizedRepository) {
    throw new ExecutionContextError(
      'the git repository reached from this directory is not the repository the permit was issued for',
      'repository_context_changed',
      { authorized_repository: authorizedRepository, execution_repository: current },
    );
  }
}
