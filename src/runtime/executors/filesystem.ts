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
import {
  ExecutorArgumentError,
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
      const path = absolute(action.target || requireString(action.arguments, 'path'), cwd);
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
          const destination = absolute(destinationRaw, cwd);
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
