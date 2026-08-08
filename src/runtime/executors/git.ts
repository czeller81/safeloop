/**
 * Managed git executor.
 *
 * Git is a first-class action family rather than an opaque terminal string.
 * `git push --force origin main` and `git status` are not "two shell commands";
 * they are two operations with very different consequences, and policy should
 * be able to say so without pattern-matching English.
 *
 * Each operation maps to a fixed argv template. The agent supplies structured
 * arguments; this module decides the flags. That inversion is what stops
 * `git commit -m "msg"` from smuggling `--amend --no-verify` through a message
 * field, and it means an approval bound to `operation: "commit"` cannot be
 * spent on a force push.
 */

import { spawn } from 'child_process';
import { redactAndBound } from '../redaction';
import {
  ExecutorArgumentError,
  optionalString,
  requireString,
  type ExecutorContext,
  type ExecutorOutcome,
  type ManagedExecutorPlugin,
} from './types';

export type GitOperation =
  | 'status' | 'diff' | 'log' | 'show' | 'branch_list' | 'remote_list'
  | 'add' | 'commit' | 'push' | 'force_push' | 'pull' | 'fetch'
  | 'checkout' | 'switch' | 'branch_create' | 'branch_delete'
  | 'remote_add' | 'remote_set_url' | 'remote_remove'
  | 'reset' | 'reset_hard' | 'clean' | 'tag_create' | 'tag_delete';

type ArgvBuilder = (args: Record<string, unknown>) => string[];

/**
 * The complete set of git operations SafeLoop can run. An operation absent from
 * this table cannot be executed at all — there is no passthrough.
 */
const TEMPLATES: Record<GitOperation, ArgvBuilder> = {
  status: () => ['status', '--porcelain=v1', '--branch'],
  diff: (args) => ['diff', ...(optionalString(args, 'ref') ? [optionalString(args, 'ref') as string] : [])],
  log: (args) => ['log', `--max-count=${clampCount(args.max_count)}`, '--pretty=format:%H %an %ad %s', '--date=iso'],
  show: (args) => ['show', '--stat', requireString(args, 'ref')],
  branch_list: () => ['branch', '--list', '--all'],
  remote_list: () => ['remote', '-v'],

  add: (args) => ['add', '--', ...pathList(args)],
  commit: (args) => ['commit', '-m', requireString(args, 'message')],
  push: (args) => ['push', requireString(args, 'remote'), requireString(args, 'ref')],
  force_push: (args) => ['push', '--force', requireString(args, 'remote'), requireString(args, 'ref')],
  pull: (args) => ['pull', '--ff-only', requireString(args, 'remote'), requireString(args, 'ref')],
  fetch: (args) => ['fetch', requireString(args, 'remote')],

  checkout: (args) => ['checkout', requireString(args, 'ref')],
  switch: (args) => ['switch', requireString(args, 'ref')],
  branch_create: (args) => ['branch', requireString(args, 'branch')],
  branch_delete: (args) => ['branch', '-D', requireString(args, 'branch')],

  remote_add: (args) => ['remote', 'add', requireString(args, 'remote'), requireString(args, 'url')],
  remote_set_url: (args) => ['remote', 'set-url', requireString(args, 'remote'), requireString(args, 'url')],
  remote_remove: (args) => ['remote', 'remove', requireString(args, 'remote')],

  reset: (args) => ['reset', requireString(args, 'ref')],
  reset_hard: (args) => ['reset', '--hard', requireString(args, 'ref')],
  clean: () => ['clean', '-fd'],
  tag_create: (args) => ['tag', requireString(args, 'tag')],
  tag_delete: (args) => ['tag', '-d', requireString(args, 'tag')],
};

function clampCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(500, Math.max(1, Math.floor(parsed)));
}

function pathList(args: Record<string, unknown>): string[] {
  const paths = args.paths;
  if (Array.isArray(paths) && paths.every((entry) => typeof entry === 'string')) {
    return paths.length > 0 ? (paths as string[]) : ['.'];
  }
  const single = optionalString(args, 'path');
  return single ? [single] : ['.'];
}

export function isGitOperation(value: string): value is GitOperation {
  return value in TEMPLATES;
}

export function gitOperations(): GitOperation[] {
  return Object.keys(TEMPLATES).sort() as GitOperation[];
}

/** The exact argv SafeLoop would run. Exposed so approvals can display it. */
export function buildGitArgv(operation: string, args: Record<string, unknown>): string[] {
  if (!isGitOperation(operation)) {
    throw new ExecutorArgumentError(`unsupported git operation: ${operation}`);
  }
  return TEMPLATES[operation](args);
}

export function createGitExecutor(): ManagedExecutorPlugin {
  return {
    kind: 'git',

    async execute(context: ExecutorContext): Promise<ExecutorOutcome> {
      const { action } = context;
      const argv = buildGitArgv(action.operation, action.arguments);
      const cwd = action.cwd || process.cwd();
      const startedAt = Date.now();

      return new Promise<ExecutorOutcome>((resolvePromise) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const child = spawn('git', argv, {
          cwd,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Never let git open an editor or a credential prompt inside a
            // governed session: it would hang until the timeout kills it.
            GIT_TERMINAL_PROMPT: '0',
            GIT_EDITOR: 'true',
          },
        });

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, context.timeoutMs);

        const finish = (outcome: ExecutorOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(outcome);
        };

        child.stdout?.on('data', (chunk) => {
          if (stdout.length < context.maxOutputBytes * 2) stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
          if (stderr.length < context.maxOutputBytes * 2) stderr += String(chunk);
        });

        const detail = { git_operation: action.operation, argv: ['git', ...argv], cwd };

        child.on('error', (error) => {
          finish({ status: 'FAILED', stderr: context.redact(error.message), detail: { ...detail, spawn_error: error.message } });
        });

        child.on('close', (code, signal) => {
          const durationMs = Date.now() - startedAt;
          if (timedOut) {
            finish({
              status: 'TIMED_OUT',
              stdout: redactAndBound(stdout, context.maxOutputBytes),
              stderr: redactAndBound(stderr, context.maxOutputBytes),
              detail: { ...detail, duration_ms: durationMs },
            });
            return;
          }
          finish({
            status: code === 0 ? 'EXECUTED' : 'FAILED',
            exit_code: typeof code === 'number' ? code : undefined,
            stdout: redactAndBound(stdout, context.maxOutputBytes),
            stderr: redactAndBound(stderr, context.maxOutputBytes),
            detail: { ...detail, duration_ms: durationMs, signal },
          });
        });
      });
    },
  };
}
