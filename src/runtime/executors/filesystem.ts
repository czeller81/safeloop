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
import { dirname, isAbsolute, resolve } from 'path';
import { redactAndBound } from '../redaction';
import { attachExecutionProof, filesystemDeltaSummary, observeFileState, type ExecutionProofRecord, type ExecutionVerificationStatus, type ObservedFileState } from '../executionProof';
import { verifyExecutionCwd, verifyResolvedPath } from '../executionContext';
import {
  containmentModeForOperation,
  resolveRealPath,
  verifyContainment,
  type ContainmentMode,
} from '../workspace';
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
  return observeFileState(path).sha256;
}

function proof(
  operation: FilesystemOperation,
  before: unknown,
  after: unknown,
  result: Record<string, unknown>,
  status: ExecutionVerificationStatus,
  summary: string,
): ExecutionProofRecord {
  return {
    executor: 'filesystem',
    operation,
    before,
    after,
    result,
    verification_status: status,
    verification_summary: summary,
    verification_scope: 'Direct filesystem state observed by SafeLoop at the resolved target path; file contents are not stored.',
  };
}


function fileStateVerification(state: ObservedFileState, fullHashClaim: string): { status: ExecutionVerificationStatus; summary: string } {
  if (state.observation_status === 'UNAVAILABLE') {
    return { status: 'NOT_VERIFIABLE', summary: `${fullHashClaim} state could not be observed` };
  }
  if (state.observation_status === 'ABSENT') {
    return { status: 'FAILED', summary: `${fullHashClaim} state was confirmed absent` };
  }
  if (state.object_type !== 'file') {
    return { status: 'VERIFIED', summary: `${fullHashClaim} metadata observed` };
  }
  if (state.sha256) {
    return { status: 'VERIFIED', summary: `${fullHashClaim} file state and complete content hash observed` };
  }
  if (state.hash_capped) {
    return {
      status: 'PARTIALLY_VERIFIED',
      summary: `${fullHashClaim} file state observed; content hash not computed because file exceeded evidence hashing limit`,
    };
  }
  return { status: 'NOT_VERIFIABLE', summary: `${fullHashClaim} file state observed but content hash could not be computed` };
}

function absentVerification(state: ObservedFileState, label: string): { status: ExecutionVerificationStatus; summary: string; confirmed: boolean } {
  if (state.observation_status === 'ABSENT') return { status: 'VERIFIED', summary: `${label} confirmed absent`, confirmed: true };
  if (state.observation_status === 'UNAVAILABLE') return { status: 'NOT_VERIFIABLE', summary: `${label} could not be observed`, confirmed: false };
  return { status: 'FAILED', summary: `${label} still present after operation`, confirmed: false };
}

function moveVerification(sourceAfter: ObservedFileState, destinationAfter: ObservedFileState): { status: ExecutionVerificationStatus; summary: string; moved: boolean | 'unknown' } {
  const source = absentVerification(sourceAfter, 'move source');
  const destination = fileStateVerification(destinationAfter, 'move destination');
  if (source.status === 'NOT_VERIFIABLE' || destination.status === 'NOT_VERIFIABLE') {
    return { status: 'NOT_VERIFIABLE', summary: 'move post-state could not be fully observed', moved: 'unknown' };
  }
  if (!source.confirmed || destinationAfter.observation_status !== 'OBSERVED') {
    return { status: 'FAILED', summary: 'move post-state did not match expected source/destination transition', moved: false };
  }
  if (destination.status === 'PARTIALLY_VERIFIED') {
    return { status: 'PARTIALLY_VERIFIED', summary: destination.summary, moved: true };
  }
  return { status: 'VERIFIED', summary: 'source absence and destination file state observed', moved: true };
}
function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

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
 *
 * SL-RC3-HIGH-002: binding the cwd was still not sufficient, because a symlink
 * anywhere else in the target's ancestry redirects the path just as effectively
 * — including one directory below a correctly verified cwd. Relation equality
 * cannot see it: two siblings share a relation, so the guard read "still
 * inside" while the bytes moved to a sibling the policy engine would have
 * refused outright. The permit therefore binds the *resolved path* as well, and
 * the last check below is that the object being written is the object that was
 * authorized. Relation is checked first so a genuine boundary crossing is still
 * reported as one.
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

  // Same relation, same root, same cwd — and still possibly a different
  // directory. Throws before any syscall when it is.
  verifyResolvedPath(
    check.resolved,
    role === 'destination' ? context.authorizedResolvedDestination : context.authorizedResolvedTarget,
    role,
  );

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
      const path = guardPath(context, requested, containmentModeForOperation(operation), 'target');
      const beforeState = observeFileState(path);
      const before = beforeState.sha256;
      const artifacts: ExecutorArtifact[] = [];

      const record = (operationName: string, targetPath: string): void => {
        const state = observeFileState(targetPath);
        const hash = state.sha256 ?? (state.hash_capped ? 'sha256:capped' : state.observation_status === 'ABSENT' ? 'sha256:absent' : 'sha256:unavailable');
        artifacts.push({ path: targetPath, content_hash: hash, operation: operationName });
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
            detail: attachExecutionProof(
              { path, operation, bytes: Buffer.byteLength(content), content_hash: before },
              (() => { const after = observeFileState(path); const verdict = fileStateVerification(after, 'read target'); return proof(operation, beforeState, after, { bytes_read: Buffer.byteLength(content) }, verdict.status, verdict.summary); })(),
            ),
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
            detail: attachExecutionProof(
              { path, operation, entry_count: entries.length },
              proof(operation, beforeState, observeFileState(path), { entry_count: entries.length }, 'VERIFIED', 'directory listing metadata observed'),
            ),
          };
        }

        case 'stat': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const stats = statSync(path);
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof({
              path,
              operation,
              is_file: stats.isFile(),
              is_directory: stats.isDirectory(),
              size: stats.size,
              modified_at: stats.mtime.toISOString(),
              content_hash: before,
            }, proof(operation, beforeState, observeFileState(path), { stat_observed: true }, 'VERIFIED', 'stat metadata observed')),
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
          const afterState = observeFileState(path);
          record(operation, path);
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof(
              { path, operation, bytes: Buffer.byteLength(content), content_hash_before: before, content_hash_after: afterState.sha256 },
              (() => { const verdict = fileStateVerification(afterState, 'post-write'); return proof(operation, beforeState, afterState, { bytes_written: Buffer.byteLength(content), summary: filesystemDeltaSummary(beforeState, afterState) }, verdict.status, verdict.summary); })(),
            ),
            artifacts,
          };
        }

        case 'append': {
          const content = optionalString(action.arguments, 'content') ?? '';
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, content, 'utf8');
          const afterState = observeFileState(path);
          record(operation, path);
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof(
              { path, operation, bytes: Buffer.byteLength(content), content_hash_before: before, content_hash_after: afterState.sha256 },
              (() => { const verdict = fileStateVerification(afterState, 'post-append'); return proof(operation, beforeState, afterState, { bytes_written: Buffer.byteLength(content), summary: filesystemDeltaSummary(beforeState, afterState) }, verdict.status, verdict.summary); })(),
            ),
            artifacts,
          };
        }

        case 'mkdir': {
          mkdirSync(path, { recursive: true });
          const afterState = observeFileState(path);
          artifacts.push({ path, content_hash: 'sha256:directory', operation });
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof({ path, operation }, proof(operation, beforeState, afterState, { directory_created: afterState.exists === true }, afterState.observation_status === 'OBSERVED' ? 'VERIFIED' : 'NOT_VERIFIABLE', afterState.observation_status === 'OBSERVED' ? 'directory existence observed' : 'directory post-state could not be observed')),
            artifacts,
          };
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
          const destinationBefore = observeFileState(destination);
          renameSync(path, destination);
          const sourceAfter = observeFileState(path);
          const destinationAfter = observeFileState(destination);
          artifacts.push({ path, content_hash: 'sha256:absent', operation: 'move_from' });
          record('move_to', destination);
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof(
              { path, destination, operation, content_hash_before: before, content_hash_after: destinationAfter.sha256 },
              (() => { const verdict = moveVerification(sourceAfter, destinationAfter); return proof(operation, { source: beforeState, destination: destinationBefore }, { source: sourceAfter, destination: destinationAfter }, { moved: verdict.moved }, verdict.status, verdict.summary); })(),
            ),
            artifacts,
          };
        }

        case 'delete': {
          if (!existsSync(path)) {
            return { status: 'FAILED', stderr: `path does not exist: ${path}`, detail: { path, operation } };
          }
          const wasDirectory = statSync(path).isDirectory();
          rmSync(path, { recursive: wasDirectory, force: false });
          const afterState = observeFileState(path);
          artifacts.push({ path, content_hash: before ?? 'sha256:directory', operation: 'delete' });
          return {
            status: 'EXECUTED',
            detail: attachExecutionProof(
              { path, operation, was_directory: wasDirectory, content_hash_before: before },
              (() => { const verdict = absentVerification(afterState, 'post-delete path'); return proof(operation, beforeState, afterState, { deleted: verdict.confirmed ? true : afterState.observation_status === 'UNAVAILABLE' ? 'unknown' : false }, verdict.status, verdict.summary); })(),
            ),
            artifacts,
          };
        }

        default:
          throw new ExecutorArgumentError(`unsupported filesystem operation: ${operation}`);
      }
    },
  };
}
