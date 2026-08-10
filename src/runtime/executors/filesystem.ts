/**
 * Managed filesystem executor.
 *
 * Filesystem evidence records the path, operation, and content hashes before
 * and after the change — never the file body. A governed agent editing a file
 * full of customer data should not cause that data to be copied into an audit
 * ledger that outlives the task.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, isAbsolute, resolve } from 'path';
import { redactAndBound } from '../redaction';
import { verifyExecutionCwd } from '../executionContext';
import { resolveRealPath, verifyContainment, type ContainmentMode } from '../workspace';
import {
  ExecutorArgumentError,
  WorkspaceContainmentError,
  optionalString,
  requireString,
  type ExecutorArtifact,
  type ExecutorContext,
  type ExecutorOutcome,
  type ManagedExecutorPlugin,
} from './types';

export type FilesystemOperation =
  | 'read'
  | 'list'
  | 'stat'
  | 'create'
  | 'write'
  | 'overwrite'
  | 'append'
  | 'mkdir'
  | 'move'
  | 'delete';

const OPERATIONS: ReadonlySet<string> = new Set<FilesystemOperation>([
  'read', 'list', 'stat', 'create', 'write', 'overwrite', 'append', 'mkdir', 'move', 'delete',
]);

function hashFile(path: string): string | undefined {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
  } catch {
    return undefined;
  }
}

function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Operations that act on the entry itself rather than on what it points to.
 * `rm` unlinks a symlink; `rename` moves it. Following the final component for
 * these and operating on the resolved target would destroy or move the wrong
 * object — precisely the outcome being defended against.
 */
const NO_FOLLOW_FINAL: ReadonlySet<string> = new Set(['delete', 'move']);

/**
 * Re-verify containment immediately before the side effect, and return the
 * path to actually operate on.
 *
 * SL-RC1-HIGH-001: a permit is issued against a proposal-time classification,
 * but symlinks are mutable, so the same pathname can resolve somewhere else by
 * the time execution runs. The rule enforced here is that the execution-time
 * relation must *equal* the relation the permit was issued under. That closes
 * the escape in both directions without turning this into a workspace-only
 * executor: an action legitimately authorized as outside-workspace still
 * executes, as long as it is still outside.
 *
 * For `follow` mode the returned path is fully resolved, so the operation no
 * longer traverses the mutable component at all.
 *
 * SL-RC3-HIGH-001: containment alone is not sufficient, because a *relative*
 * path means nothing until it is joined to a working directory, and that
 * directory is mutable host state like any other. Two sibling directories share
 * a workspace relation and a workspace root, so re-pointing the cwd symlink
 * after authorization redirected a relative target into a sibling while every
 * check above still passed. The permit has always signed `execution_cwd`; this
 * executor simply never consulted it. It does now, on the same equality rule
 * the shell and git executors use, and the *verified* directory becomes the
 * resolution base so the join cannot traverse the mutable component either.
 */
function guardPath(
  context: ExecutorContext,
  rawPath: string,
  mode: ContainmentMode,
  role: 'target' | 'destination',
): string {
  const authorized = context.authorizedWorkspaceRelation ?? 'unknown';

  // Bind the resolution base before resolving anything against it. Throws (and
  // so reaches no syscall) when the declared directory has moved or cannot be
  // resolved. Returns undefined only when no cwd was declared, in which case
  // there is no context to have been redirected and resolution falls back to
  // the process directory exactly as before.
  const verifiedCwd = verifyExecutionCwd(context.action.cwd || undefined, context.authorizedExecutionCwd);
  const check = verifyContainment(rawPath, context.workspace, verifiedCwd, mode);

  // The workspace root must still be the same filesystem object it was when
  // the permit was issued. Replacing the workspace directory with a symlink
  // moves the target and the root together, so the relation alone still reads
  // "inside" while the bytes land somewhere else entirely.
  if (context.workspace) {
    const currentRoot = resolveRealPath(context.workspace);
    if (context.authorizedWorkspaceRoot && currentRoot !== context.authorizedWorkspaceRoot) {
      throw new WorkspaceContainmentError(
        'the workspace root now resolves to a different location than when the permit was issued',
        'workspace_relation_changed',
        { role, authorized_workspace_root: context.authorizedWorkspaceRoot, execution_workspace_root: currentRoot },
      );
    }
    if (!context.authorizedWorkspaceRoot) {
      throw new WorkspaceContainmentError(
        'the permit carries no authorized workspace root to verify against',
        'workspace_verification_failed',
        { role },
      );
    }
  }

  if (!check.verifiable) {
    throw new WorkspaceContainmentError(
      `workspace containment could not be verified for the ${role} path`,
      'workspace_verification_failed',
      { role, authorized_relation: authorized, reason: check.reason },
    );
  }

  if (check.relation !== authorized) {
    throw new WorkspaceContainmentError(
      `the ${role} path was authorized as ${authorized} the workspace but now resolves ${check.relation} it`,
      'workspace_relation_changed',
      { role, authorized_relation: authorized, execution_relation: check.relation },
    );
  }

  return check.resolved;
}

export function createFilesystemExecutor(): ManagedExecutorPlugin {
  return {
    kind: 'filesystem',

    async execute(context: ExecutorContext): Promise<ExecutorOutcome> {
      const { action } = context;
      const operation = action.operation as FilesystemOperation;
      if (!OPERATIONS.has(operation)) {
        throw new ExecutorArgumentError(`unsupported filesystem operation: ${action.operation}`);
      }

      const cwd = action.cwd || process.cwd();
      const requested = action.target || requireString(action.arguments, 'path');
      // Verified here, immediately before any syscall — not at proposal time.
      const path = guardPath(
        context,
        requested,
        NO_FOLLOW_FINAL.has(operation) ? 'no_follow_final' : 'follow',
        'target',
      );
      const before = hashFile(path);
      const artifacts: ExecutorArtifact[] = [];

      const record = (operationName: string, targetPath: string): void => {
        const hash = hashFile(targetPath);
        artifacts.push({ path: targetPath, content_hash: hash ?? 'sha256:absent', operation: operationName });
      };

      switch (operation) {
        case 'read': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const content = readFileSync(path, 'utf8');
          return {
            status: 'EXECUTED',
            stdout: redactAndBound(content, context.maxOutputBytes),
            detail: { path, operation, bytes: Buffer.byteLength(content), content_hash: before },
          };
        }

        case 'list': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const entries = readdirSync(path).sort();
          return {
            status: 'EXECUTED',
            stdout: entries.join('\n'),
            detail: { path, operation, entry_count: entries.length },
          };
        }

        case 'stat': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const stats = statSync(path);
          return {
            status: 'EXECUTED',
            detail: {
              path,
              operation,
              is_file: stats.isFile(),
              is_directory: stats.isDirectory(),
              size: stats.size,
              modified_at: stats.mtime.toISOString(),
              content_hash: before,
            },
          };
        }

        case 'create':
        case 'write':
        case 'overwrite': {
          const content = optionalString(action.arguments, 'content') ?? '';
          if (operation === 'create' && existsSync(path)) {
            return {
              status: 'FAILED',
              stderr: `create refused: ${path} already exists (use write or overwrite)`,
              detail: { path, operation },
            };
          }
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content, 'utf8');
          record(operation, path);
          return {
            status: 'EXECUTED',
            detail: { path, operation, bytes: Buffer.byteLength(content), content_hash_before: before, content_hash_after: hashFile(path) },
            artifacts,
          };
        }

        case 'append': {
          const content = optionalString(action.arguments, 'content') ?? '';
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, content, 'utf8');
          record(operation, path);
          return {
            status: 'EXECUTED',
            detail: { path, operation, bytes: Buffer.byteLength(content), content_hash_before: before, content_hash_after: hashFile(path) },
            artifacts,
          };
        }

        case 'mkdir': {
          mkdirSync(path, { recursive: true });
          artifacts.push({ path, content_hash: 'sha256:directory', operation });
          return { status: 'EXECUTED', detail: { path, operation }, artifacts };
        }

        case 'move': {
          const destinationRaw = optionalString(action.arguments, 'destination');
          if (!destinationRaw) {
            throw new ExecutorArgumentError('move requires a "destination" argument');
          }
          // Both ends of a dual-path operation are security-significant: a
          // safe source with a swapped destination escapes just as easily.
          const destination = guardPath(context, destinationRaw, 'no_follow_final', 'destination');
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          mkdirSync(dirname(destination), { recursive: true });
          renameSync(path, destination);
          artifacts.push({ path, content_hash: 'sha256:absent', operation: 'move_from' });
          record('move_to', destination);
          return {
            status: 'EXECUTED',
            detail: { path, destination, operation, content_hash_before: before },
            artifacts,
          };
        }

        case 'delete': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const wasDirectory = statSync(path).isDirectory();
          rmSync(path, { recursive: wasDirectory, force: false });
          artifacts.push({ path, content_hash: before ?? 'sha256:directory', operation: 'delete' });
          return {
            status: 'EXECUTED',
            detail: { path, operation, was_directory: wasDirectory, content_hash_before: before },
            artifacts,
          };
        }

        default:
          throw new ExecutorArgumentError(`unsupported filesystem operation: ${operation}`);
      }
    },
  };
}
