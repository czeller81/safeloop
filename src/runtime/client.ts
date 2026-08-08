/**
 * SafeLoop runtime SDK (TypeScript).
 *
 * Ergonomics matter here: an SDK that is harder than calling the tool directly
 * does not get adopted, and ungoverned convenience is the failure mode this
 * project exists to prevent. So the common path is one call:
 *
 *     const session = await safeloop.startSession({ ... });
 *     const result  = await session.execute({ kind: 'shell', argv: ['npm', 'test'] });
 *
 * `execute()` performs propose → permit → execute in one round trip's worth of
 * ceremony. When policy holds the action, it returns a result carrying the
 * approval request instead of throwing, so an adapter can surface the hold to a
 * human and resume with `executeApproved()`.
 *
 * Policy lives in the runtime. This client holds none of it, and no decision it
 * reports can be reached without the runtime having made it.
 */

import { readConnectionFile, type RuntimeConnectionFile } from './runtimeAuth';
import type {
  ActionKind,
  ActionProposal,
  AgentIdentity,
  ApprovalGrant,
  ApprovalRedemption,
  BoundApprovalToken,
  ExecutionResult,
  GovernanceDecision,
  MemoryCandidate,
  MemoryDecision,
  RuntimeHealth,
  SessionContext,
} from './protocol';
import type { RuntimeStatus } from './runtimeCore';
import type { MemoryWriteResult } from './memoryStore';
import type { SafeloopStorageOptions } from '../localStorage';

export interface SafeloopClientOptions {
  baseUrl?: string;
  credential?: string;
  storageOptions?: SafeloopStorageOptions;
  fetchImpl?: typeof fetch;
}

export class SafeloopRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'SafeloopRequestError';
  }
}

/** Shorthand action shapes so adapters do not hand-build protocol objects. */
export type ExecuteInput =
  | { kind: 'shell'; argv: string[]; cwd?: string; timeout_ms?: number }
  | { kind: 'shell'; command: string; shell: true; cwd?: string; timeout_ms?: number }
  | { kind: 'filesystem'; operation: string; path: string; content?: string; destination?: string; cwd?: string }
  | { kind: 'git'; operation: string; cwd: string; args?: Record<string, unknown> }
  | { kind: 'http'; method: string; url: string; operation?: string; body?: string; credential_reference?: string }
  | { kind: 'mcp'; server: string; tool: string; args?: Record<string, unknown> }
  | { kind: ActionKind; action: ActionProposal };

export function toActionProposal(input: ExecuteInput, agentId: string): ActionProposal {
  const base = { agent_id: agentId };

  if ('action' in input) return { ...input.action, ...base };

  switch (input.kind) {
    case 'shell':
      return 'command' in input
        ? { ...base, action_kind: 'shell', operation: 'exec', tool: 'shell', arguments: { command: input.command, shell: true }, cwd: input.cwd }
        : { ...base, action_kind: 'shell', operation: 'exec', tool: 'shell', arguments: { argv: input.argv }, cwd: input.cwd };
    case 'filesystem':
      return {
        ...base,
        action_kind: 'filesystem',
        operation: input.operation,
        tool: 'filesystem',
        target: input.path,
        cwd: input.cwd,
        arguments: {
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.destination !== undefined ? { destination: input.destination } : {}),
        },
      };
    case 'git':
      return { ...base, action_kind: 'git', operation: input.operation, tool: 'git', cwd: input.cwd, target: input.cwd, arguments: input.args ?? {} };
    case 'http':
      return {
        ...base,
        action_kind: 'http',
        operation: input.operation ?? (/^(GET|HEAD|OPTIONS)$/i.test(input.method) ? 'read' : 'write'),
        tool: 'http',
        method: input.method,
        resource: input.url,
        arguments: {
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.credential_reference ? { credential_reference: input.credential_reference } : {}),
        },
      };
    case 'mcp':
      return { ...base, action_kind: 'mcp', operation: 'call', tool: 'mcp', target: `${input.server}.${input.tool}`, arguments: { arguments: input.args ?? {} } };
    default:
      return { ...base, action_kind: 'custom', operation: 'unknown', arguments: {} };
  }
}

export interface ExecuteOutcome {
  decision: GovernanceDecision;
  result?: ExecutionResult;
  /** True when the runtime held the action for a human. */
  held: boolean;
  /** The exact proposal that was governed; needed to resume after approval. */
  proposal: ActionProposal;
}

export interface SafeloopSession {
  readonly session: SessionContext;
  readonly credential: string;
  startTask(input?: { task_id?: string; goal?: string }): Promise<{ task_id: string }>;
  propose(input: ExecuteInput, taskId: string): Promise<GovernanceDecision>;
  /** propose → permit → execute. Returns `held: true` instead of throwing when approval is required. */
  execute(input: ExecuteInput, taskId: string): Promise<ExecuteOutcome>;
  /** Resume a held action once an approval token has been granted. */
  executeApproved(proposal: ActionProposal, taskId: string, token: BoundApprovalToken): Promise<ExecutionResult>;
  memory: {
    propose(candidate: MemoryCandidate, taskId: string): Promise<MemoryDecision>;
    persist(candidate: MemoryCandidate, decision: MemoryDecision): Promise<MemoryWriteResult>;
    /** Govern and, if authorized, activate in one call. */
    remember(candidate: MemoryCandidate, taskId: string): Promise<MemoryWriteResult>;
    active(): Promise<unknown[]>;
  };
  finishTask(taskId: string): Promise<void>;
  finish(): Promise<void>;
}

export interface SafeloopClient {
  health(): Promise<RuntimeHealth>;
  status(): Promise<RuntimeStatus>;
  startSession(input: {
    agent: AgentIdentity;
    tenant_id: string;
    workspace?: string;
    profile?: string;
    scenario_id?: string;
    parent_session_id?: string;
    parent_credential?: string;
  }): Promise<SafeloopSession>;
  grantApproval(input: { approval_request_id: string; approver: string; ttl_ms?: number }): Promise<ApprovalGrant>;
  redeemApproval(input: { credential: string; session_id: string; task_id: string; token: BoundApprovalToken; action: ActionProposal }): Promise<ApprovalRedemption>;
  request<T>(path: string, body?: Record<string, unknown>, method?: 'GET' | 'POST'): Promise<T>;
}

/** Resolve connection details from the daemon's 0600 connection file. */
export function resolveConnection(options: SafeloopClientOptions = {}): { baseUrl: string; credential: string } {
  if (options.baseUrl && options.credential) {
    return { baseUrl: options.baseUrl, credential: options.credential };
  }
  const file: RuntimeConnectionFile | undefined = readConnectionFile(options.storageOptions);
  if (!file) {
    throw new SafeloopRequestError(0, 'runtime_unavailable',
      'No SafeLoop runtime connection file was found. Start one with `safeloop daemon start`.');
  }
  return {
    baseUrl: options.baseUrl ?? `http://${file.host}:${file.port}`,
    credential: options.credential ?? file.credential,
  };
}

export function createSafeloopClient(options: SafeloopClientOptions = {}): SafeloopClient {
  const { baseUrl, credential } = resolveConnection(options);
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string, body?: Record<string, unknown>, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${credential}`,
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new SafeloopRequestError(
        response.status,
        String(payload.error ?? 'runtime_error'),
        String(payload.message ?? `SafeLoop runtime returned ${response.status}`),
      );
    }
    return payload as T;
  }

  const client: SafeloopClient = {
    health: () => request<RuntimeHealth>('/health', undefined, 'GET'),
    status: () => request<RuntimeStatus>('/v1/status', undefined, 'GET'),
    grantApproval: (input) => request<ApprovalGrant>('/v1/approval/grant', input),
    redeemApproval: (input) => request<ApprovalRedemption>('/v1/approval/redeem', input as never),
    request,

    async startSession(input): Promise<SafeloopSession> {
      const handle = await request<{ session: SessionContext; credential: string }>('/v1/session/start', input as never);
      const sessionCredential = handle.credential;
      const sessionId = handle.session.session_id;
      const agentId = handle.session.agent.agent_id;

      const session: SafeloopSession = {
        session: handle.session,
        credential: sessionCredential,

        async startTask(taskInput = {}) {
          return request<{ task_id: string }>('/v1/task/start', {
            credential: sessionCredential, session_id: sessionId, ...taskInput,
          });
        },

        async propose(actionInput, taskId) {
          return request<GovernanceDecision>('/v1/action/propose', {
            credential: sessionCredential,
            session_id: sessionId,
            task_id: taskId,
            action: toActionProposal(actionInput, agentId),
          });
        },

        async execute(actionInput, taskId): Promise<ExecuteOutcome> {
          const proposal = toActionProposal(actionInput, agentId);
          const decision = await request<GovernanceDecision>('/v1/action/propose', {
            credential: sessionCredential, session_id: sessionId, task_id: taskId, action: proposal,
          });

          if (!decision.execution_permit) {
            return { decision, held: decision.requires_approval, proposal };
          }

          const result = await request<ExecutionResult>('/v1/action/execute', {
            credential: sessionCredential,
            session_id: sessionId,
            permit: decision.execution_permit,
            action: proposal,
            timeout_ms: 'timeout_ms' in actionInput ? actionInput.timeout_ms : undefined,
          });
          return { decision, result, held: false, proposal };
        },

        async executeApproved(proposal, taskId, token): Promise<ExecutionResult> {
          const redemption = await request<ApprovalRedemption>('/v1/approval/redeem', {
            credential: sessionCredential, session_id: sessionId, task_id: taskId, token, action: proposal,
          });
          if (!redemption.redeemed || !redemption.execution_permit) {
            throw new SafeloopRequestError(403, redemption.failure ?? 'approval_rejected',
              redemption.reason ?? 'the approval token was not accepted');
          }
          return request<ExecutionResult>('/v1/action/execute', {
            credential: sessionCredential,
            session_id: sessionId,
            permit: redemption.execution_permit,
            action: proposal,
          });
        },

        memory: {
          propose: (candidate, taskId) => request<MemoryDecision>('/v1/memory/propose', {
            credential: sessionCredential, session_id: sessionId, task_id: taskId, candidate,
          }),
          persist: (candidate, decision) => request<MemoryWriteResult>('/v1/memory/persist', {
            credential: sessionCredential, session_id: sessionId, candidate, decision,
            permit: decision.persistence_permit,
          }),
          async remember(candidate, taskId) {
            const decision = await session.memory.propose(candidate, taskId);
            return session.memory.persist(candidate, decision);
          },
          async active() {
            const payload = await request<{ memories: unknown[] }>('/v1/memory/active', {
              credential: sessionCredential, session_id: sessionId,
            });
            return payload.memories;
          },
        },

        async finishTask(taskId) {
          await request('/v1/task/finish', { credential: sessionCredential, session_id: sessionId, task_id: taskId });
        },

        async finish() {
          await request('/v1/session/finish', { credential: sessionCredential, session_id: sessionId });
        },
      };

      return session;
    },
  };

  return client;
}
