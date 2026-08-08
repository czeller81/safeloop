/**
 * Managed shell executor.
 *
 * Structured argv is the preferred form: `{ argv: ["npm", "test"] }` runs
 * without a shell, so metacharacters in arguments are inert. When an action
 * genuinely needs shell interpretation it must say so explicitly via
 * `{ command: "...", shell: true }` — shell interpretation is represented in
 * the action, never inferred, so the fingerprint an approver saw records
 * whether a shell was involved.
 *
 * Destructive-command detection is NOT duplicated here. That decision belongs
 * to the profile and the existing CommandGuard policy; by the time an action
 * reaches this executor the runtime has already verified and consumed a permit.
 */

import { spawn } from 'child_process';
import { describeEnvironment, redactAndBound } from '../redaction';
import {
  ExecutorArgumentError,
  optionalString,
  requireStringArray,
  type ExecutorContext,
  type ExecutorOutcome,
  type ManagedExecutorPlugin,
} from './types';

export interface ShellExecutorOptions {
  /** Environment for the child. Defaults to a minimal, inherited-safe set. */
  baseEnv?: NodeJS.ProcessEnv;
}

/** Variables stripped from the child so a session cannot re-enter SafeLoop's trust boundary. */
const STRIPPED_ENV = [
  'SAFELOOP_RUNTIME_SECRET',
  'SAFELOOP_RUNTIME_CREDENTIAL',
  'SAFELOOP_HERMES_APPROVED',
];

function childEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of STRIPPED_ENV) delete env[name];
  return env;
}

export function createShellExecutor(options: ShellExecutorOptions = {}): ManagedExecutorPlugin {
  return {
    kind: 'shell',

    async execute(context: ExecutorContext): Promise<ExecutorOutcome> {
      const { action } = context;
      const args = action.arguments;
      const useShell = args.shell === true;

      let file: string;
      let argv: string[];

      if (useShell) {
        const command = optionalString(args, 'command');
        if (!command) {
          throw new ExecutorArgumentError('shell execution requires a "command" string when shell is true');
        }
        file = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
        argv = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
      } else {
        const declared = requireStringArray(args, 'argv');
        if (declared.length === 0) {
          throw new ExecutorArgumentError('shell execution requires a non-empty "argv" array');
        }
        [file, ...argv] = declared;
      }

      const cwd = action.cwd || process.cwd();
      const env = childEnvironment(options.baseEnv ?? process.env);
      const startedAt = Date.now();

      return new Promise<ExecutorOutcome>((resolvePromise) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const child = spawn(file, argv, {
          cwd,
          env,
          shell: false, // never implicit: shell mode is expressed by file/argv above
          stdio: ['ignore', 'pipe', 'pipe'],
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

        const detail = {
          executable: file,
          argv,
          shell_interpretation: useShell,
          cwd,
          environment: describeEnvironment(env as Record<string, string>).slice(0, 64),
        };

        child.on('error', (error) => {
          finish({
            status: 'FAILED',
            stderr: context.redact(String(error.message)),
            detail: { ...detail, spawn_error: error.message },
          });
        });

        child.on('close', (code, signal) => {
          const durationMs = Date.now() - startedAt;
          if (timedOut) {
            finish({
              status: 'TIMED_OUT',
              stdout: redactAndBound(stdout, context.maxOutputBytes),
              stderr: redactAndBound(stderr, context.maxOutputBytes),
              detail: { ...detail, duration_ms: durationMs, timeout_ms: context.timeoutMs },
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
