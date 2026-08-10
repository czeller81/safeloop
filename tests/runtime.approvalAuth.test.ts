/**
 * Who may approve.
 *
 * An audit of the approval-lifecycle context binding found that all of it was
 * defending a gate that did not need to be attacked. `/v1/approval/grant` was
 * protected by the same daemon-wide bearer credential as `/v1/action/propose`,
 * so the agent — which must hold that credential to propose anything at all —
 * could grant its own held actions. Proposed, self-approved, redeemed,
 * executed, with a free-text `approver` string recorded as though a person had
 * decided. Every execution-context check downstream passed honestly, because
 * nothing had been substituted: the attacker simply asked for the location it
 * wanted and approved it.
 *
 * The invariant under test:
 *
 *   THE CREDENTIAL THAT PROPOSES AN ACTION MUST NOT BE ABLE TO APPROVE IT.
 *
 * The second half of this file covers the other half of consent: one human
 * decision authorizes one execution, not a supply of them.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startDaemon, type RunningDaemon } from '../src/runtime/daemon';
import { connectionFilePath, operatorCredentialFilePath, readOperatorCredentialFile } from '../src/runtime/runtimeAuth';
import { isSensitivePath } from '../src/runtime/workspace';

let baseDir: string;
let root: string;
let workspace: string;
let daemon: RunningDaemon;
let baseUrl: string;
/** Exactly what a governed agent holds. */
let agentCredential: string;
/** Exactly what the human holds, from its own 0600 file. */
let operatorCredential: string;

async function call<T>(path: string, body: unknown, bearer: string): Promise<{ status: number; json: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, json: (await response.json()) as T };
}

async function heldAction(target: string) {
  const session = await call<{ session: { session_id: string }; credential: string }>(
    '/v1/session/start',
    { agent: { agent_id: 'attacker' }, tenant_id: 'tenant-a', workspace, profile: 'coding' },
    agentCredential,
  );
  const sessionId = session.json.session.session_id;
  const sessionCred = session.json.credential;
  const task = await call<{ task_id: string }>('/v1/task/start',
    { credential: sessionCred, session_id: sessionId }, agentCredential);

  const action = {
    action_kind: 'filesystem', operation: 'write', target,
    arguments: { content: 'PAYLOAD' }, agent_id: 'attacker',
  };
  const decision = await call<{ disposition: string; approval_request: { approval_request_id: string } }>(
    '/v1/action/propose',
    { credential: sessionCred, session_id: sessionId, task_id: task.json.task_id, action },
    agentCredential,
  );
  expect(decision.json.disposition).toBe('REQUIRE_APPROVAL');
  return { sessionId, sessionCred, taskId: task.json.task_id, action, decision: decision.json };
}

beforeEach(async () => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-approvalauth-state-'));
  root = mkdtempSync(join(tmpdir(), 'safeloop-v02-approvalauth-'));
  workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  daemon = await startDaemon({
    storageOptions: { baseDir }, defaultProfile: 'coding', workspace, socket: false, port: 0,
  });
  baseUrl = `http://${daemon.connection.host}:${daemon.connection.port}`;
  agentCredential = daemon.connection.credential;
  operatorCredential = readOperatorCredentialFile({ baseDir })!.credential;
});

afterEach(async () => {
  await daemon.stop();
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('the agent credential cannot approve', () => {
  it('A: refuses a grant presented with the agent credential', async () => {
    const victim = join(root, 'victim');
    mkdirSync(victim);
    const held = await heldAction(join(victim, 'owned.txt'));

    const grant = await call<{ error: string; message: string }>(
      '/v1/approval/grant',
      { approval_request_id: held.decision.approval_request.approval_request_id, approver: 'attacker-self' },
      agentCredential,
    );

    expect(grant.status).toBe(401);
    expect(grant.json.error).toBe('unauthenticated');
    expect(grant.json.message).toContain('operator credential');
    expect(existsSync(join(victim, 'owned.txt'))).toBe(false);
  });

  it('B: the full self-approval chain now dead-ends at the grant', async () => {
    const victim = join(root, 'victim');
    mkdirSync(victim);
    const held = await heldAction(join(victim, 'owned.txt'));

    // Propose → grant → redeem → execute, using only what the agent has.
    const grant = await call<{ token?: unknown }>(
      '/v1/approval/grant',
      { approval_request_id: held.decision.approval_request.approval_request_id, approver: 'attacker-self' },
      agentCredential,
    );
    expect(grant.status).toBe(401);
    expect(grant.json.token).toBeUndefined();

    // With no token there is nothing to redeem, and nothing executes.
    const redemption = await call<{ redeemed: boolean; failure?: string }>(
      '/v1/approval/redeem',
      { credential: held.sessionCred, session_id: held.sessionId, task_id: held.taskId, token: grant.json.token, action: held.action },
      agentCredential,
    );
    expect(redemption.json.redeemed).toBe(false);
    expect(existsSync(join(victim, 'owned.txt'))).toBe(false);
  });

  it('C: the operator credential works, and the approved action then executes', async () => {
    const victim = join(root, 'victim');
    mkdirSync(victim);
    const held = await heldAction(join(victim, 'owned.txt'));

    const grant = await call<{ approval_id: string; token: unknown }>(
      '/v1/approval/grant',
      { approval_request_id: held.decision.approval_request.approval_request_id, approver: 'a-real-human' },
      operatorCredential,
    );
    expect(grant.status).toBe(200);

    const redemption = await call<{ redeemed: boolean; execution_permit: unknown }>(
      '/v1/approval/redeem',
      { credential: held.sessionCred, session_id: held.sessionId, task_id: held.taskId, token: grant.json.token, action: held.action },
      agentCredential,
    );
    expect(redemption.json.redeemed).toBe(true);

    const execution = await call<{ status: string }>(
      '/v1/action/execute',
      { credential: held.sessionCred, session_id: held.sessionId, permit: redemption.json.execution_permit, action: held.action },
      agentCredential,
    );
    expect(execution.json.status).toBe('EXECUTED');
    expect(readFileSync(join(victim, 'owned.txt'), 'utf8')).toBe('PAYLOAD');
  });

  it('D: the operator credential does not unlock the agent routes either', async () => {
    // Not a hierarchy — two different secrets for two different roles.
    const session = await call<{ error?: string }>(
      '/v1/session/start',
      { agent: { agent_id: 'a' }, tenant_id: 't', workspace, profile: 'coding' },
      operatorCredential,
    );
    expect(session.status).toBe(401);
  });

  it('E: the two credentials are distinct secrets', () => {
    expect(operatorCredential).not.toBe(agentCredential);
    expect(operatorCredential.length).toBeGreaterThanOrEqual(64);
  });
});

describe('the operator credential is not reachable from the agent side', () => {
  it('F: it is absent from the connection file the agent reads', () => {
    const connectionFile = JSON.parse(
      readFileSync(connectionFilePath({ baseDir }), 'utf8'),
    ) as Record<string, unknown>;
    expect(JSON.stringify(connectionFile)).not.toContain(operatorCredential);
    expect(daemon.connection).not.toHaveProperty('operator_credential');
  });

  it('G: it is written 0600 and classified sensitive, so a governed read is refused', () => {
    const path = operatorCredentialFilePath({ baseDir });
    expect(existsSync(path)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o077).toBe(0);
    }
    // A `filesystem read` of this path must not be ordinary work.
    expect(isSensitivePath(path)).toBe(true);
  });

  it('H: it survives a daemon restart, unlike the connection credential', async () => {
    const before = readOperatorCredentialFile({ baseDir })!.credential;
    const firstAgentCredential = daemon.connection.credential;
    await daemon.stop();

    daemon = await startDaemon({
      storageOptions: { baseDir }, defaultProfile: 'coding', workspace, socket: false, port: 0,
    });
    baseUrl = `http://${daemon.connection.host}:${daemon.connection.port}`;

    // A human who filed this away does not find it rotated by a restart...
    expect(readOperatorCredentialFile({ baseDir })!.credential).toBe(before);
    // ...while the agent's connection credential is per-process as before.
    expect(daemon.connection.credential).not.toBe(firstAgentCredential);
  });
});

describe('one request, one grant', () => {
  it('I: a second grant for the same request is refused with a conflict', async () => {
    const victim = join(root, 'victim');
    mkdirSync(victim);
    const held = await heldAction(join(victim, 'twice.txt'));
    const requestId = held.decision.approval_request.approval_request_id;

    const first = await call<{ approval_id: string; token: unknown }>(
      '/v1/approval/grant', { approval_request_id: requestId, approver: 'operator' }, operatorCredential);
    expect(first.status).toBe(200);

    const second = await call<{ error: string; message: string; token?: unknown }>(
      '/v1/approval/grant', { approval_request_id: requestId, approver: 'operator' }, operatorCredential);

    expect(second.status).toBe(409);
    expect(second.json.error).toBe('approval_already_granted');
    expect(second.json.token).toBeUndefined();
  });

  it('J: the one granted token redeems once and the action runs once', async () => {
    const victim = join(root, 'victim');
    mkdirSync(victim);
    const held = await heldAction(join(victim, 'once.txt'));

    const grant = await call<{ token: unknown }>('/v1/approval/grant',
      { approval_request_id: held.decision.approval_request.approval_request_id, approver: 'operator' },
      operatorCredential);

    const redeemBody = {
      credential: held.sessionCred, session_id: held.sessionId, task_id: held.taskId,
      token: grant.json.token, action: held.action,
    };
    const first = await call<{ redeemed: boolean; execution_permit: unknown }>(
      '/v1/approval/redeem', redeemBody, agentCredential);
    expect(first.json.redeemed).toBe(true);

    const second = await call<{ redeemed: boolean; failure: string }>(
      '/v1/approval/redeem', redeemBody, agentCredential);
    expect(second.json.redeemed).toBe(false);
    expect(second.json.failure).toBe('consumed');

    const execution = await call<{ status: string }>('/v1/action/execute',
      { credential: held.sessionCred, session_id: held.sessionId, permit: first.json.execution_permit, action: held.action },
      agentCredential);
    expect(execution.json.status).toBe('EXECUTED');
  });
});
