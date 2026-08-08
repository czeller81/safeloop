/**
 * RC3 — execution-context binding across shell, git, and HTTP.
 *
 * RC1 bound authorization to a path string; RC2 fixed that for the filesystem
 * and then reproduced the identical defect in two more executors:
 *
 *   shell — a command authorized to run in one directory ran in another
 *   git   — a commit authorized for repository A landed in repository B
 *
 * and this campaign found a third over the network:
 *
 *   http  — a POST authorized for host A was delivered, body intact, to host B
 *           via a 307/308 redirect, while evidence still recorded host A
 *
 * The invariant under test: THE ACTION THAT EXECUTES MUST STILL BE THE
 * SECURITY-SIGNIFICANT ACTION THAT WAS AUTHORIZED.
 *
 * Every rejection test asserts the side effect did not occur. A refusal that
 * still ran the command would be worthless.
 */

import { execFileSync } from 'child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { resolveRepositoryIdentity } from '../src/runtime/executionContext';
import type { ActionProposal } from '../src/runtime/protocol';

let baseDir: string;
let root: string;
let workspace: string;
let insideDir: string;
let outsideDir: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

function boot(ws: string): void {
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace: ws });
  handle = runtime.startSession({ agent: { agent_id: 'attacker' }, tenant_id: 'tenant-a', workspace: ws, profile: 'coding' });
  taskId = runtime.startTask(handle.credential, { session_id: handle.session.session_id }).task_id;
}

function propose(action: ActionProposal) {
  return runtime.propose(handle.credential, { session_id: handle.session.session_id, task_id: taskId, action });
}

function execute(permit: unknown, action: ActionProposal) {
  return runtime.execute(handle.credential, { session_id: handle.session.session_id, permit: permit as never, action });
}

/** Obtain a permit, approving when policy holds the action. */
function authorize(action: ActionProposal) {
  const decision = propose(action);
  if (decision.execution_permit) return { decision, permit: decision.execution_permit };
  if (decision.approval_request) {
    const grant = runtime.grantApproval({
      approval_request_id: decision.approval_request.approval_request_id, approver: 'operator',
    });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id, task_id: taskId, token: grant.token, action,
    });
    return { decision, permit: redemption.execution_permit };
  }
  return { decision, permit: undefined };
}

function repoint(link: string, target: string): void {
  unlinkSync(link);
  symlinkSync(target, link);
}

function shellAction(cwd: string, script = 'echo landed > marker.txt'): ActionProposal {
  return {
    action_kind: 'shell', operation: 'exec', cwd,
    arguments: { argv: ['sh', '-c', script] }, agent_id: 'attacker',
  };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-ctx-state-'));
  root = mkdtempSync(join(tmpdir(), 'safeloop-v02-ctx-'));
  workspace = join(root, 'workspace');
  insideDir = join(workspace, 'real');
  outsideDir = join(root, 'outside');
  mkdirSync(insideDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  boot(workspace);
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- SHELL ----

describe('shell cwd execution-context binding', () => {
  it('A: refuses when the cwd parent symlink is swapped after authorization', async () => {
    const link = join(workspace, 'link');
    symlinkSync(insideDir, link);
    const action = shellAction(link);

    const { permit } = authorize(action);
    expect(permit?.execution_cwd).toBeDefined();

    repoint(link, outsideDir);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('cwd_context_changed');
    expect(existsSync(join(outsideDir, 'marker.txt'))).toBe(false);
    expect(existsSync(join(insideDir, 'marker.txt'))).toBe(false);
  });

  it('B: refuses when a nested cwd ancestor is swapped', async () => {
    const deep = join(insideDir, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    const mid = join(workspace, 'mid');
    symlinkSync(insideDir, mid);
    const action = shellAction(join(mid, 'a', 'b'));

    const { permit } = authorize(action);
    const outsideDeep = join(outsideDir, 'a', 'b');
    mkdirSync(outsideDeep, { recursive: true });
    repoint(mid, outsideDir);

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDeep, 'marker.txt'))).toBe(false);
  });

  it('C: refuses when the final cwd directory is replaced by a symlink', async () => {
    const dir = join(workspace, 'dir');
    mkdirSync(dir, { recursive: true });
    const action = shellAction(dir);

    const { permit } = authorize(action);
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(outsideDir, dir);

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'marker.txt'))).toBe(false);
  });

  it('D: refuses when the workspace root itself is swapped', async () => {
    const action = shellAction(insideDir);
    const { permit } = authorize(action);

    mkdirSync(join(outsideDir, 'real'), { recursive: true });
    rmSync(workspace, { recursive: true, force: true });
    symlinkSync(outsideDir, workspace);

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'real', 'marker.txt'))).toBe(false);
  });

  it.each([
    ['E: relative symlink', (ws: string, inside: string) => symlinkSync(relative(ws, inside), join(ws, 'rel')), 'rel'],
    ['F: absolute symlink', (ws: string, inside: string) => symlinkSync(inside, join(ws, 'abs')), 'abs'],
  ])('%s is refused when repointed', async (_label, make, name) => {
    make(workspace, insideDir);
    const link = join(workspace, name);
    const action = shellAction(link);
    const { permit } = authorize(action);

    repoint(link, outsideDir);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'marker.txt'))).toBe(false);
  });

  it('G: refuses when a link in a symlink chain is repointed', async () => {
    symlinkSync(insideDir, join(workspace, 'c1'));
    symlinkSync(join(workspace, 'c1'), join(workspace, 'c2'));
    const action = shellAction(join(workspace, 'c2'));
    const { permit } = authorize(action);

    repoint(join(workspace, 'c1'), outsideDir);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'marker.txt'))).toBe(false);
  });

  it('H: executes normally when the cwd is unchanged', async () => {
    const action = shellAction(insideDir);
    const { permit } = authorize(action);

    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(join(insideDir, 'marker.txt'), 'utf8').trim()).toBe('landed');
  });

  it('I: still executes an explicitly authorized outside-workspace cwd', async () => {
    // SafeLoop must not become "shell always runs in the workspace". If the
    // action was proposed and authorized against a directory outside it, and
    // that directory has not moved, it runs.
    const action = shellAction(outsideDir);
    const { permit } = authorize(action);
    expect(permit).toBeDefined();

    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(existsSync(join(outsideDir, 'marker.txt'))).toBe(true);
  });

  it('J: fails closed when the cwd disappears before execution', async () => {
    const dir = join(insideDir, 'transient');
    mkdirSync(dir, { recursive: true });
    const action = shellAction(dir);
    const { permit } = authorize(action);

    rmSync(dir, { recursive: true, force: true });
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(dir, 'marker.txt'))).toBe(false);
  });

  it('K: fails closed on an unresolvable symlink loop', async () => {
    const a = join(insideDir, 'loop-a');
    const b = join(insideDir, 'loop-b');
    symlinkSync(b, a);
    symlinkSync(a, b);

    const action = shellAction(a);
    const { permit } = authorize(action);
    if (!permit) return; // policy already refused — also fail-closed
    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
  });

  it('refuses a permit carrying no authorized cwd', async () => {
    const action = shellAction(insideDir);
    const decision = propose(action);
    const bare = runtime.permits().issue({
      action_fingerprint: decision.action_fingerprint,
      agent_id: 'attacker', task_id: taskId, session_id: handle.session.session_id,
      scenario_id: 'coding', tenant_id: 'tenant-a', disposition: 'ALLOW',
      workspace_relation: decision.execution_permit?.workspace_relation,
      workspace_root: decision.execution_permit?.workspace_root,
      // execution_cwd deliberately omitted
    });

    const result = await execute(bare, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('execution_context_verification_failed');
    expect(existsSync(join(insideDir, 'marker.txt'))).toBe(false);
  });

  it('keeps a permit consumed after a context rejection', async () => {
    const link = join(workspace, 'retry');
    symlinkSync(insideDir, link);
    const action = shellAction(link);
    const { permit } = authorize(action);

    repoint(link, outsideDir);
    expect((await execute(permit, action)).rejection_reason).toBe('cwd_context_changed');

    // Restoring the safe directory must not turn the permit into a retry token.
    repoint(link, insideDir);
    const second = await execute(permit, action);
    expect(second.rejection_reason).toBe('permit_consumed');
    expect(existsSync(join(insideDir, 'marker.txt'))).toBe(false);
  });
});

// ------------------------------------------------------------------ GIT ----

describe('git repository execution-context binding', () => {
  let repoA: string;
  let repoB: string;
  let link: string;

  function initRepo(dir: string, file: string): void {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'SafeLoop Test'], { cwd: dir });
    writeFileSync(join(dir, file), 'content');
    execFileSync('git', ['add', '.'], { cwd: dir });
  }

  function log(dir: string): string {
    try {
      return execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
    } catch {
      return '';
    }
  }

  function gitAction(cwd: string, operation: string, args: Record<string, unknown> = {}): ActionProposal {
    return { action_kind: 'git', operation, cwd, target: cwd, arguments: args, agent_id: 'attacker' };
  }

  beforeEach(() => {
    repoA = join(root, 'repoA');
    repoB = join(root, 'repoB');
    initRepo(repoA, 'a.txt');
    initRepo(repoB, 'b.txt');
    link = join(root, 'link');
    symlinkSync(repoA, link);
    boot(link);
  });

  it('A: an approval for repo A cannot commit in repo B after a cwd swap', async () => {
    const action = gitAction(link, 'commit', { message: 'approved-for-A' });
    const { permit } = authorize(action);
    expect(permit?.repository_identity).toBeDefined();

    repoint(link, repoB);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(log(repoA)).not.toContain('approved-for-A');
    expect(log(repoB)).not.toContain('approved-for-A');
  });

  it('B: refuses when a nested ancestor of the repository path is swapped', async () => {
    const nest = join(root, 'nest');
    mkdirSync(nest, { recursive: true });
    const inner = join(nest, 'repo');
    symlinkSync(repoA, inner);
    boot(inner);

    const action = gitAction(inner, 'commit', { message: 'nested-A' });
    const { permit } = authorize(action);

    repoint(inner, repoB);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(log(repoB)).not.toContain('nested-A');
  });

  it('C: refuses when the repository directory itself is replaced', async () => {
    const real = join(root, 'realrepo');
    initRepo(real, 'r.txt');
    boot(real);

    const action = gitAction(real, 'commit', { message: 'replaced-repo' });
    const { permit } = authorize(action);

    rmSync(real, { recursive: true, force: true });
    symlinkSync(repoB, real);

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(log(repoB)).not.toContain('replaced-repo');
  });

  it('E: refuses when .git is redirected to another repository, same cwd', async () => {
    // The directory never moves; only the repository it reaches changes. A
    // cwd-only check would miss this, which is why repository identity is
    // bound separately.
    const standalone = join(root, 'standalone');
    initRepo(standalone, 's.txt');
    boot(standalone);

    const action = gitAction(standalone, 'commit', { message: 'git-dir-swap' });
    const { permit } = authorize(action);

    rmSync(join(standalone, '.git'), { recursive: true, force: true });
    writeFileSync(join(standalone, '.git'), `gitdir: ${join(repoB, '.git')}\n`);

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('repository_context_changed');
    expect(log(repoB)).not.toContain('git-dir-swap');
  });

  it('F: commits normally when the repository is unchanged', async () => {
    const action = gitAction(link, 'commit', { message: 'legitimate-commit' });
    const { permit } = authorize(action);

    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(log(repoA)).toContain('legitimate-commit');
    expect(log(repoB)).not.toContain('legitimate-commit');
  });

  it('G: read-only git operations still work unchanged', async () => {
    const action = gitAction(link, 'status');
    const { permit } = authorize(action);
    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
  });

  it.each([
    ['I: reset_hard', 'reset_hard', { ref: 'HEAD' }],
    ['J: clean', 'clean', {}],
  ])('%s approved for A cannot mutate B', async (_label, operation, args) => {
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repoA });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repoB });
    writeFileSync(join(repoB, 'precious.txt'), 'must survive');

    const action = gitAction(link, operation, args);
    const { permit } = authorize(action);
    if (!permit) return; // policy refused outright — also acceptable

    repoint(link, repoB);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(readFileSync(join(repoB, 'precious.txt'), 'utf8')).toBe('must survive');
  });

  it('K: fails closed when no repository can be identified', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain, { recursive: true });
    boot(plain);

    const action = gitAction(plain, 'commit', { message: 'no-repo' });
    const { permit } = authorize(action);
    if (!permit) return;

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
  });

  it('resolves repository identity through a symlinked path to the same repo', () => {
    // Same repository reached two ways must produce one identity, or
    // legitimate work would break.
    expect(resolveRepositoryIdentity(link)).toBe(resolveRepositoryIdentity(repoA));
    expect(resolveRepositoryIdentity(repoA)).not.toBe(resolveRepositoryIdentity(repoB));
  });
});

// ----------------------------------------------------------------- HTTP ----

describe('http destination execution-context binding', () => {
  let authorized: { server: Server; port: number };
  let unauthorized: { server: Server; port: number };
  let received: Array<{ method: string; body: string }>;
  let redirectStatus: number;

  type Handler = (request: IncomingMessage, response: ServerResponse) => void;

  function listen(handler: Handler): Promise<{ server: Server; port: number }> {
    return new Promise((resolvePromise) => {
      const server = createServer(handler);
      server.listen(0, '127.0.0.1', () => resolvePromise({ server, port: (server.address() as never as { port: number }).port }));
    });
  }

  beforeEach(async () => {
    received = [];
    redirectStatus = 307;
    unauthorized = await listen((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += String(chunk); });
      request.on('end', () => {
        received.push({ method: request.method ?? '', body });
        response.writeHead(200); response.end('B');
      });
    });
    authorized = await listen((_request, response) => {
      response.writeHead(redirectStatus, { location: `http://127.0.0.1:${unauthorized.port}/landed` });
      response.end();
    });
  });

  afterEach(() => {
    authorized.server.close();
    unauthorized.server.close();
  });

  function httpAction(method: string, operation: string): ActionProposal {
    return {
      action_kind: 'http', operation, method,
      resource: `http://127.0.0.1:${authorized.port}/authorized`,
      arguments: method === 'POST' ? { body: 'CONSEQUENTIAL-PAYLOAD' } : {},
      agent_id: 'attacker',
    };
  }

  it.each([301, 302, 307, 308])(
    'a POST authorized for one host is not delivered to another via %i',
    async (status) => {
      redirectStatus = status;
      const action = httpAction('POST', 'write');
      const { permit } = authorize(action);
      if (!permit) return;

      const result = await execute(permit, action);

      // The unauthorized server must never see the request at all.
      expect(received).toHaveLength(0);
      expect(result.detail?.redirect_not_followed).toBe(true);
      expect(result.detail?.port).toBe(String(authorized.port));
    },
  );

  it('does not leak the consequential body to an unauthorized host', async () => {
    redirectStatus = 308;
    const action = httpAction('POST', 'write');
    const { permit } = authorize(action);
    if (!permit) return;

    await execute(permit, action);
    expect(received.map((entry) => entry.body)).not.toContain('CONSEQUENTIAL-PAYLOAD');
  });

  it('reports the redirect target so the agent can propose it for governance', async () => {
    redirectStatus = 302;
    const action = httpAction('POST', 'write');
    const { permit } = authorize(action);
    if (!permit) return;

    const result = await execute(permit, action);
    expect(String(result.detail?.redirect_location)).toContain(String(unauthorized.port));
    expect(String(result.detail?.redirect_note)).toMatch(/propose the redirect target/i);
  });

  it('leaves a non-redirecting request completely unchanged', async () => {
    const plain = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ORDINARY-RESPONSE');
    });
    try {
      const action: ActionProposal = {
        action_kind: 'http', operation: 'write', method: 'POST',
        resource: `http://127.0.0.1:${plain.port}/ok`,
        arguments: { body: 'payload' }, agent_id: 'attacker',
      };
      const { permit } = authorize(action);
      if (!permit) return;

      const result = await execute(permit, action);
      expect(result.status).toBe('EXECUTED');
      expect(result.stdout).toContain('ORDINARY-RESPONSE');
      expect(result.detail?.redirect_not_followed).toBeUndefined();
    } finally {
      plain.server.close();
    }
  });
});
