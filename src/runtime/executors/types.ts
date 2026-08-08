import type { ActionKind, CanonicalAction } from '../protocol';

export interface ExecutorArtifact {
  path: string;
  content_hash: string;
  operation: string;
}

export interface ExecutorOutcome {
  status: 'EXECUTED' | 'FAILED' | 'TIMED_OUT';
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  detail?: Record<string, unknown>;
  artifacts?: ExecutorArtifact[];
}

export interface ExecutorContext {
  action: CanonicalAction;
  workspace?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Applied to every captured stream before it reaches evidence or the ledger. */
  redact(text: string): string;
}

/**
 * A managed executor performs exactly one action family. It is reached only
 * after the runtime has verified and consumed an execution permit, so it never
 * makes policy decisions of its own — it validates its own arguments and runs.
 */
export interface ManagedExecutorPlugin {
  kind: ActionKind;
  execute(context: ExecutorContext): Promise<ExecutorOutcome>;
}

/** Thrown for malformed action arguments. Surfaces as `executor_error`. */
export class ExecutorArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorArgumentError';
  }
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecutorArgumentError(`action argument "${key}" must be a non-empty string`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ExecutorArgumentError(`action argument "${key}" must be a string`);
  }
  return value;
}

export function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ExecutorArgumentError(`action argument "${key}" must be an array of strings`);
  }
  return value as string[];
}
