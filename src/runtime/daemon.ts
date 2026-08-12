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
  loadOperatorCredential,
  operatorCredentialFilePath,
  removeConnectionFile,
  scrubCredentials,
  writeConnectionFile,
  type RuntimeConnectionFile,
} from './runtimeAuth';
import type { SafeloopStorageOptions } from '../localStorage';
import { buildSessionTimelinePage } from './sessionWorkGraph';

export const DEFAULT_DAEMON_PORT = 3787;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface DaemonConfig extends SafeloopRuntimeConfig {
  port?: number;
  /** Disable the unix socket transport (used by tests and on Windows). */
  socket?: boolean;
  credential?: string;
  /**
   * The approver's bearer credential. Defaults to the persisted operator
   * credential file, minting one on first start. Never equal to `credential`:
   * see the SL-RC3-CRIT-002 note on RouteAuth.
   */
  operatorCredential?: string;
}

export interface RunningDaemon {
  runtime: SafeloopRuntime;
  connection: RuntimeConnectionFile;
  /**
   * Where the approver's credential is kept. The value is deliberately absent
   * from `connection`, which is the file the agent reads.
   */
  operatorCredentialPath: string;
  transports: string[];
  stop(): Promise<void>;
}

/**
 * Which bearer credential a route accepts.
 *
 *   none     — liveness only.
 *   runtime  — the connection-file credential every governed agent holds.
 *   operator — the human approver's credential, which an agent does not hold.
 *
 * SL-RC3-CRIT-002: `operator` is not a stronger form of `runtime`; it is a
 * different secret. Accepting the runtime credential on an approval route
 * would let the agent that proposed an action approve it, which is exactly the
 * defect this level exists to close, so the two are never interchangeable.
 */
type RouteAuth = 'none' | 'runtime' | 'operator';

interface Route {
  method: 'GET' | 'POST';
  path: string;
  auth: RouteAuth;
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

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new RuntimeError('invalid_request', `"${key}" must be boolean`);
  return value;
}

function optionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RuntimeError('invalid_request', `"${key}" must be an integer`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new RuntimeError('invalid_request', `"${key}" must be a non-empty string`);
  return value;
}

function requireTimelineSessionRead(body: Record<string, unknown>, runtime: SafeloopRuntime): string {
  const sessionId = requireString(body, 'session_id');
  const credential = sessionCredential(body);
  const owned = runtime.sessions().some((state) => state.session.session_id === sessionId && credentialsMatch(state.credential, credential));
  if (!owned) {
    throw new RuntimeError('unauthenticated', 'a valid session credential is required');
  }
  return sessionId;
}

export function buildRoutes(storageOptions: SafeloopStorageOptions = {}): Route[] {
  return [
    {
      method: 'GET', path: '/health', auth: 'none',
      handle: (_body, runtime) => runtime.health(),
    },
    {
      method: 'GET', path: '/v1/status', auth: 'runtime',
      handle: (_body, runtime) => runtime.status(),
    },
    {
      method: 'POST', path: '/v1/session/start', auth: 'runtime',
      handle: (body, runtime) => runtime.startSession(body as never),
    },
    {
      method: 'POST', path: '/v1/session/timeline', auth: 'runtime',
      handle: (body, runtime) => {
        const sessionId = requireTimelineSessionRead(body, runtime);
        try {
          return buildSessionTimelinePage(sessionId, storageOptions, {
            limit: optionalInteger(body, 'limit'),
            cursor: optionalString(body, 'cursor'),
            includeLegacyEvents: optionalBoolean(body, 'include_legacy_events') ?? false,
          });
        } catch (error) {
          if (error instanceof Error && (error.message === 'invalid_cursor' || error.message === 'invalid_limit')) {
            throw new RuntimeError('invalid_request', error.message);
          }
          throw error;
        }
      },
    },
    {
      method: 'POST', path: '/v1/session/finish', auth: 'runtime',
      handle: (body, runtime) => {
        runtime.finishSession(sessionCredential(body), requireString(body, 'session_id'));
        return { finished: true };
      },
    },
    {
      method: 'POST', path: '/v1/task/start', auth: 'runtime',
      handle: (body, runtime) => runtime.startTask(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/task/finish', auth: 'runtime',
      handle: (body, runtime) => {
        runtime.finishTask(sessionCredential(body), body as never);
        return { finished: true };
      },
    },
    {
      method: 'POST', path: '/v1/action/propose', auth: 'runtime',
      handle: (body, runtime) => runtime.propose(sessionCredential(body), body as never),
    },
    {
      // The human decision point. Deliberately NOT reachable with the
      // credential the proposing agent holds.
      method: 'POST', path: '/v1/approval/grant', auth: 'operator',
      handle: (body, runtime) => runtime.grantApproval(body as never),
    },
    {
      method: 'POST', path: '/v1/approval/redeem', auth: 'runtime',
      handle: (body, runtime) => runtime.redeemApproval(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/action/execute', auth: 'runtime',
      handle: (body, runtime) => runtime.execute(sessionCredential(body), body as never),
    },
    {
      // Reporting only. Enforcement stays with the adapter, which fails closed
      // independently of whether this call succeeds.
      method: 'POST', path: '/v1/control/verify', auth: 'runtime',
      handle: (body, runtime) => runtime.reportControlVerification(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/propose', auth: 'runtime',
      handle: (body, runtime) => runtime.proposeMemory(sessionCredential(body), body as never),
    },
    {
      // Governance without storage: for adapters whose own memory engine owns
      // durable storage. Consumes the permit and returns the authorization.
      method: 'POST', path: '/v1/memory/authorize', auth: 'runtime',
      handle: (body, runtime) => runtime.authorizeMemoryPersistence(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/persist', auth: 'runtime',
      handle: (body, runtime) => runtime.persistMemory(sessionCredential(body), body as never),
    },
    {
      method: 'POST', path: '/v1/memory/active', auth: 'runtime',
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
  approval_already_granted: 409,
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
  const credential = config.credential ?? generateRuntimeCredential();
  const operatorCredential = config.operatorCredential ?? loadOperatorCredential(storageOptions);

  // Resolved and checked before anything is constructed or bound, because the
  // failure this prevents is silent by nature.
  //
  // SL-RC3-HIGH-005: the approval routes are separated from the agent routes by
  // *which secret they check*, and by nothing else. Configure the two to the
  // same value and both checks consult the same string again, so the agent that
  // proposes an action can approve it — the whole defect the operator
  // credential exists to close, restored with no error, no warning, and no log
  // line. Every execution-context check downstream still passes honestly,
  // because nothing has been substituted.
  //
  // Refusing to start is the only safe response. A warning would be read once,
  // at boot, by nobody, and the deployment would run that way for months. The
  // most likely way to reach here is migrating from the single-credential model
  // by reusing the credential already in hand, which is exactly the case that
  // must not quietly appear to work.
  if (credential === operatorCredential) {
    throw new Error(
      'SafeLoop refused to start: the operator credential is identical to the runtime credential. '
      + 'They must be different secrets. The runtime credential is held by the agent so it can propose '
      + 'and execute actions; the operator credential authorizes human approval on /v1/approval/*. '
      + 'Making them equal lets an agent approve its own held actions. '
      + 'Leave `operatorCredential` unset to use the managed operator-credential.json, or supply a '
      + 'distinct value. See docs/HUMAN_APPROVALS.md.',
    );
  }

  const runtime = createSafeloopRuntime(config);
  const routes = buildRoutes(storageOptions);
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

        if (route.auth !== 'none') {
          // Each level checks exactly one secret. The runtime credential is not
          // accepted on an operator route, so an agent that holds it cannot
          // approve the actions it proposes.
          const expected = route.auth === 'operator' ? operatorCredential : credential;
          if (!credentialsMatch(expected, bearerFromHeaders(request.headers))) {
            // Same response whether the credential is absent or merely wrong.
            send(response, 401, {
              error: 'unauthenticated',
              message: route.auth === 'operator'
                ? 'a valid operator credential is required; the runtime credential cannot approve actions'
                : 'a valid runtime credential is required',
            });
            return;
          }
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
    operatorCredentialPath: operatorCredentialFilePath(storageOptions),
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
