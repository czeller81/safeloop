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
import {
  containmentModeForOperation,
  resolveRealPath,
  resolveRealPathStrict,
  verifyContainment,
} from './workspace';
import type { CanonicalAction } from './protocol';

/** How long a git identity probe may take before we treat it as unverifiable. */
const GIT_PROBE_TIMEOUT_MS = 5_000;

export type ExecutionContextReason =
  /** The resolved working directory is not the one that was authorized. */
  | 'cwd_context_changed'
  /** The git repository reached from cwd is not the one that was authorized. */
  | 'repository_context_changed'
  /** The path resolved somewhere other than where it was authorized to land. */
  | 'target_context_changed'
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
  const gitDir = gitProbe(cwd, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return null;

  // Resolve so a symlinked git directory cannot masquerade as a different one.
  return resolveRealPath(gitDir);
}

/** Run one git plumbing command and return its trimmed stdout, or null. */
function gitProbe(cwd: string | undefined, argv: string[]): string | null {
  if (!cwd) return null;

  const probe = spawnSync('git', argv, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  if (probe.error || probe.status !== 0) return null;
  const out = (probe.stdout || '').trim();
  return out ? out : null;
}

/**
 * Where the next ref-mutating git operation would land.
 *
 * SL-RC3-HIGH-003: repository identity answers *which repository*, never *which
 * branch*. `git symbolic-ref HEAD refs/heads/release` leaves the git directory
 * completely untouched, so an approved commit re-aimed at a protected branch
 * passed identity verification and landed there. Both halves are bound:
 *
 *   head_ref    the branch HEAD points at, or '' when HEAD is detached
 *   head_commit the object HEAD resolves to, or '' on an unborn branch
 *
 * `symbolic-ref` rather than `rev-parse --symbolic-full-name` is deliberate: it
 * succeeds on an unborn branch (where rev-parse fails outright) and fails on a
 * detached HEAD (where rev-parse reports the literal string "HEAD"). That makes
 * "attached" and "detached" distinguishable, which matters because checking a
 * branch out at the commit HEAD was already detached on would otherwise compare
 * equal while redirecting the commit onto that branch.
 *
 * Every real repository state populates at least one of the two, so a fully
 * empty result means the probes could not run and callers fail closed.
 */
export interface GitHeadState {
  head_ref: string;
  head_commit: string;
}

export function resolveGitHead(cwd: string | undefined): GitHeadState {
  return {
    head_ref: gitProbe(cwd, ['symbolic-ref', 'HEAD']) ?? '',
    head_commit: gitProbe(cwd, ['rev-parse', 'HEAD']) ?? '',
  };
}

/**
 * Git operations whose effect does NOT depend on where HEAD points, and which
 * therefore do not need HEAD bound.
 *
 * The set is expressed as the exemption rather than as the list of mutating
 * operations so that anything added to the executor's template table later is
 * bound by default. Requiring HEAD for a read is merely strict; forgetting it
 * for a write is the defect this exists to prevent.
 */
const HEAD_INDEPENDENT_GIT_OPERATIONS: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'branch_list', 'remote_list',
  // Writes only remote-tracking refs and repository config; neither reads HEAD.
  'fetch', 'remote_add', 'remote_set_url', 'remote_remove',
]);

export function gitOperationDependsOnHead(operation: string): boolean {
  return !HEAD_INDEPENDENT_GIT_OPERATIONS.has(operation);
}

export interface AuthorizedExecutionContext {
  execution_cwd?: string;
  repository_identity?: string;
  head_ref?: string;
  head_commit?: string;
  resolved_target?: string;
  resolved_destination?: string;
}

/** The action facts this module needs; a canonical action satisfies it. */
export type ContextualAction = Pick<
  CanonicalAction,
  'action_kind' | 'operation' | 'cwd' | 'target' | 'arguments'
>;

/** The filesystem path an action names, from either of its two spellings. */
function filesystemTargetOf(action: ContextualAction): string {
  if (action.target) return action.target;
  const fromArguments = action.arguments?.path;
  return typeof fromArguments === 'string' ? fromArguments : '';
}

function filesystemDestinationOf(action: ContextualAction): string {
  const destination = action.arguments?.destination;
  return typeof destination === 'string' ? destination : '';
}

/**
 * Compute the execution-context facts to sign into a permit.
 *
 * Kept action-kind-specific on purpose. Running `git rev-parse` for every shell
 * command would add subprocesses to the hot path for facts that shell
 * authorization does not depend on, and resolving a target path for a git
 * action would bind something git does not act on.
 */
export function captureExecutionContext(
  action: ContextualAction,
  workspace?: string,
): AuthorizedExecutionContext {
  const context: AuthorizedExecutionContext = {};
  const cwd = action.cwd || undefined;

  try {
    context.execution_cwd = resolveExecutionCwd(cwd);
  } catch {
    // Leave it unset. The executor fails closed on a missing authorized fact
    // when a cwd is declared, so an unresolvable cwd cannot become permission.
    return context;
  }

  if (action.action_kind === 'git') {
    const repository = resolveRepositoryIdentity(context.execution_cwd ?? cwd);
    if (repository) context.repository_identity = repository;

    const head = resolveGitHead(context.execution_cwd ?? cwd);
    if (head.head_ref) context.head_ref = head.head_ref;
    if (head.head_commit) context.head_commit = head.head_commit;
  }

  if (action.action_kind === 'filesystem') {
    // SL-RC3-HIGH-002: bind where the bytes actually land, not merely which
    // side of the workspace boundary that place sits on. Resolution goes
    // through `verifyContainment` — the same function the executor re-runs
    // immediately before the syscall — so the two answers are produced by one
    // implementation and cannot drift.
    const mode = containmentModeForOperation(action.operation);

    const target = filesystemTargetOf(action);
    if (target) {
      const check = verifyContainment(target, workspace, context.execution_cwd, mode);
      if (check.verifiable) context.resolved_target = check.resolved;
    }

    const destination = filesystemDestinationOf(action);
    if (destination) {
      // A move acts on the destination entry itself, never on what it points
      // to, so it is always resolved in no-follow-final mode.
      const check = verifyContainment(destination, workspace, context.execution_cwd, 'no_follow_final');
      if (check.verifiable) context.resolved_destination = check.resolved;
    }
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
 * Re-verify that a filesystem path still resolves to the object the permit was
 * issued against.
 *
 * SL-RC3-HIGH-002: the workspace relation is a one-bit fact, and two directories
 * that share it are interchangeable under it. Re-pointing a symlink anywhere in
 * a target's ancestry moved a write into a sibling — including a sibling the
 * policy engine would have refused outright — while containment, workspace
 * root, and cwd all still verified. The relation says which side of the boundary
 * the bytes land on; this says which object they land in.
 *
 * `resolved` must come from `verifyContainment`, so the string compared here was
 * produced by the same resolver, in the same mode, that produced the authorized
 * value.
 */
export function verifyResolvedPath(
  resolved: string,
  authorizedResolved: string | undefined,
  role: 'target' | 'destination',
): void {
  if (!authorizedResolved) {
    throw new ExecutionContextError(
      `the permit carries no authorized resolved ${role} path to verify against`,
      'execution_context_verification_failed',
      { role, execution_resolved_path: resolved },
    );
  }

  if (resolved !== authorizedResolved) {
    throw new ExecutionContextError(
      `the ${role} path now resolves to a different location than when the permit was issued`,
      'target_context_changed',
      { role, authorized_resolved_path: authorizedResolved, execution_resolved_path: resolved },
    );
  }
}

/**
 * Re-verify git repository identity immediately before a consequential
 * operation. An approval for repository A must never act on repository B.
 *
 * `operation` selects whether HEAD is bound as well. A read authorized while one
 * branch was checked out is still the same read after a concurrent checkout, and
 * refusing it would break legitimate workflows for no security gain. A write is
 * aimed by HEAD, so for a write HEAD is part of the authorization.
 */
export function verifyRepositoryIdentity(
  cwd: string | undefined,
  authorizedRepository: string | undefined,
  operation?: string,
  authorizedHead?: Partial<GitHeadState>,
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

  if (operation === undefined || !gitOperationDependsOnHead(operation)) return;

  const authorizedRef = authorizedHead?.head_ref ?? '';
  const authorizedCommit = authorizedHead?.head_commit ?? '';
  if (!authorizedRef && !authorizedCommit) {
    // Every real repository state populates at least one of the two, so both
    // being empty means the probes did not run rather than that HEAD is empty.
    throw new ExecutionContextError(
      'the permit carries no authorized HEAD state to verify against',
      'execution_context_verification_failed',
      { authorized_repository: authorizedRepository, operation },
    );
  }

  const head = resolveGitHead(cwd);
  if (head.head_ref !== authorizedRef || head.head_commit !== authorizedCommit) {
    throw new ExecutionContextError(
      'HEAD now points somewhere other than where the permit was issued, so this operation would land on a different ref',
      'repository_context_changed',
      {
        authorized_repository: authorizedRepository,
        operation,
        authorized_head_ref: authorizedRef || '(detached)',
        execution_head_ref: head.head_ref || '(detached)',
        authorized_head_commit: authorizedCommit,
        execution_head_commit: head.head_commit,
      },
    );
  }
}
