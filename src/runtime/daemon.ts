/**
 * SafeLoop local runtime daemon.
 *
 * A resident runtime, not a process per action. The v0.1 Hermes adapter spawned
 * `node dist/cli.js` for every governed tool call — roughly 150ms of Node
 * startup before any policy ran. Governance that costs that much per action
 * gets switched off, so the daemon exists as much for adoption as for
 * architecture.
 *
 * Local-first and closed by default:
 *   - binds 127.0.0.1 only; there is no option to bind a public interface
 *   - additionally listens on a 0700 unix socket on POSIX hosts
 *   - every route except /health requires the runtime bearer credential
 *   - every route carrying identity additionally requires a session credential
 *   - shuts down gracefully and removes its connection file
 *
 * Windows gets localhost HTTP today; the transport list is a field in
 * RuntimeHealth so a named-pipe transport can be added without a protocol
 * change or any change to Linux behaviour.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { chmodSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PROTOCOL_VERSION } from './protocol';
import { RUNTIME_VERSION, RuntimeError, createSafeloopRuntime, type SafeloopRuntime, type SafeloopRuntimeConfig } from './runtimeCore';
import { runtimeStateDirectory } from './runtimeSecret';
import {
  bearerFromHeaders,
  credentialsMatch,
  generateRuntimeCredential,
  removeConnectionFile,
  scrubCredentials,
  writeConnectionFile,
  type RuntimeConnectionFile,
} from './runtimeAuth';
import type { SafeloopStorageOptions } from '../localStorage';

export const DEFAULT_DAEMON_PORT = 3787;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface DaemonConfig extends SafeloopRuntimeConfig {
  port?: number;
  /** Disable the unix socket transport (used by tests and on Windows). */
  socket?: boolean;
  credential?: string;
}

export interface RunningDaemon {
  runtime: SafeloopRuntime;
  connection: RuntimeConnectionFile;
  transports: string[];
  stop(): Promise<void>;
}

interface Route {
  method: 'GET' | 'POST';
  path: string;
  /** Whether the runtime bearer credential is required. */
  authenticated: boolean;
  handle(body: Record<string, unknown>, runtime: SafeloopRuntime): unknown | Promise<unknown>;
}

function sessionCredential(body: Record<string, unknown>): string {
  const value = body.credential;
  if (typeof value !== 'string' || !value) {
    throw new RuntimeError('unauthenticated', 'a session credential is required');
  }
  return value;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value) {
    throw new RuntimeError('invalid_request', `"${key}" is required`);
  }
  return value;
}

export function buildRoutes(): Route[] {
  return [
    {
      method: 'GET', path: '/health', authenticated: false,
      handle: (_body, runtime) => runtime.health(),
    },
    {
      method: 'GET', path: '/v1/status', authenticated: true,
      handle: (_body, runtime) => runtime.status(),
    },
    {
      method: 'POST', path: '/v1/session/start', authenticated: true,
      handle: (body, runtime) => runtime.startSession(body as never),
    },
    {
      method: 'POST', path: '/v1/session/finish', authenticated: true,
      handle: (body, runtime) => {
        runtime.finishSession(sessionCredential(body), requireString(body, 'session_id'));
        return { finished: true };
      },
    },
    {
      method: 'POST', path: '/v1/task/start', authenticated: true,
      handle: (body, runtime) => runtime.startTask(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/task/finish', authenticated: true,
      handle: (body, runtime) => {
        runtime.finishTask(sessionCredential(body), body as never);
        return { finished: true };
      },
    },
    {
      method: 'POST', path: '/v1/action/propose', authenticated: true,
      handle: (body, runtime) => runtime.propose(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/approval/grant', authenticated: true,
      handle: (body, runtime) => runtime.grantApproval(body as never),
    },
    {
      method: 'POST', path: '/v1/approval/redeem', authenticated: true,
      handle: (body, runtime) => runtime.redeemApproval(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/action/execute', authenticated: true,
      handle: (body, runtime) => runtime.execute(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/propose', authenticated: true,
      handle: (body, runtime) => runtime.proposeMemory(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/persist', authenticated: true,
      handle: (body, runtime) => runtime.persistMemory(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/active', authenticated: true,
      handle: (body, runtime) => ({
        memories: runtime.activeMemories(sessionCredential(body), requireString(body, 'session_id')),
      }),
    },
  ];
}

const ERROR_STATUS: Record<string, number> = {
  unauthenticated: 401,
  identity_substitution: 403,
  privilege_widening: 403,
  unknown_session: 404,
  unknown_task: 404,
  unknown_approval_request: 404,
  session_finished: 409,
  invalid_request: 400,
};

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    let raw = '';
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejectPromise(new RuntimeError('invalid_request', 'request body exceeds the maximum size'));
        request.destroy();
        return;
      }
      raw += String(chunk);
    });
    request.on('end', () => {
      if (!raw.trim()) {
        resolvePromise({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          rejectPromise(new RuntimeError('invalid_request', 'request body must be a JSON object'));
          return;
        }
        resolvePromise(parsed as Record<string, unknown>);
      } catch {
        rejectPromise(new RuntimeError('invalid_request', 'request body is not valid JSON'));
      }
    });
    request.on('error', () => rejectPromise(new RuntimeError('invalid_request', 'request stream failed')));
  });
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-safeloop-protocol': PROTOCOL_VERSION,
  });
  response.end(body);
}

export async function startDaemon(config: DaemonConfig = {}): Promise<RunningDaemon> {
  const storageOptions: SafeloopStorageOptions = config.storageOptions ?? {};
  const runtime = createSafeloopRuntime(config);
  const credential = config.credential ?? generateRuntimeCredential();
  const routes = buildRoutes();
  const startedAt = new Date().toISOString();

  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const route = routes.find((entry) => entry.path === url.pathname && entry.method === request.method);

        if (!route) {
          send(response, 404, { error: 'not_found', message: `no route for ${request.method} ${url.pathname}` });
          return;
        }

        if (route.authenticated && !credentialsMatch(credential, bearerFromHeaders(request.headers))) {
          // Same response whether the credential is absent or wrong.
          send(response, 401, { error: 'unauthenticated', message: 'a valid runtime credential is required' });
          return;
        }

        const body = request.method === 'POST' ? await readBody(request) : {};
        const result = await route.handle(body, runtime);
        send(response, 200, result);
      } catch (error) {
        if (error instanceof RuntimeError) {
          send(response, ERROR_STATUS[error.code] ?? 400, { error: error.code, message: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        send(response, 500, { error: 'runtime_error', message: scrubCredentials(message) });
      }
    })();
  });

  const transports: string[] = [];

  const port = await new Promise<number>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    // 127.0.0.1 only. There is deliberately no option to widen this.
    server.listen(config.port ?? DEFAULT_DAEMON_PORT, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise(typeof address === 'object' && address ? address.port : (config.port ?? DEFAULT_DAEMON_PORT));
    });
  });
  transports.push(`http://127.0.0.1:${port}`);

  let socketPath: string | null = null;
  const wantsSocket = config.socket !== false && process.platform !== 'win32';
  if (wantsSocket) {
    const socketDirectory = join(runtimeStateDirectory(storageOptions), 'socket');
    mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
    try {
      chmodSync(socketDirectory, 0o700);
    } catch {
      // Best effort on filesystems without POSIX modes.
    }
    socketPath = join(socketDirectory, 'safeloop.sock');
    if (existsSync(socketPath)) rmSync(socketPath, { force: true });

    const socketServer = createServer((request, response) => server.emit('request', request, response));
    await new Promise<void>((resolvePromise) => {
      socketServer.once('error', () => resolvePromise()); // socket is a bonus transport, not a hard requirement
      socketServer.listen(socketPath as string, () => resolvePromise());
    });
    if (socketServer.listening) {
      transports.push(`unix:${socketPath}`);
      (server as Server & { socketServer?: Server }).socketServer = socketServer;
    } else {
      socketPath = null;
    }
  }

  const connection: RuntimeConnectionFile = {
    protocol_version: PROTOCOL_VERSION,
    runtime_version: RUNTIME_VERSION,
    pid: process.pid,
    started_at: startedAt,
    host: '127.0.0.1',
    port,
    socket_path: socketPath,
    credential,
  };
  writeConnectionFile(connection, storageOptions);

  return {
    runtime,
    connection,
    transports,
    async stop(): Promise<void> {
      const socketServer = (server as Server & { socketServer?: Server }).socketServer;
      if (socketServer) {
        await new Promise<void>((resolvePromise) => socketServer.close(() => resolvePromise()));
      }
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
      if (socketPath) rmSync(socketPath, { force: true });
      removeConnectionFile(storageOptions);
    },
  };
}
