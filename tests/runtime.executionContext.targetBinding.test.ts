/**
 * RC3 follow-up — binding the *object* an authorization names, not merely the
 * category it falls into.
 *
 * The RC3 campaign bound the working directory, and an independent audit of that
 * fix found the same defect twice more, one level down in each executor:
 *
 *   filesystem — the permit bound the workspace *relation*, which is one bit.
 *                Two directories that share it are interchangeable under it, so
 *                re-pointing a symlink anywhere in the target's ancestry moved a
 *                write into a sibling while containment, workspace root, and the
 *                newly-bound cwd all still verified. A write the policy engine
 *                refuses outright was delivered under an ALLOW permit.
 *
 *   git        — the permit bound repository identity, which `symbolic-ref`
 *                does not change. A commit approved on one branch landed on
 *                another inside the same repository.
 *
 * The invariant is the RC3 invariant, applied to the last mutable component:
 *
 *   THE ACTION THAT EXECUTES MUST STILL BE THE SECURITY-SIGNIFICANT ACTION
 *   THAT WAS AUTHORIZED.
 *
 * Every rejection test asserts the side effect did not occur. A refusal that
 * still wrote the file, or still moved the ref, would be worthless.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import type { ActionProposal } from '../src/runtime/protocol';

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

/** Obtain a permit, approving when policy holds the action. */
function authorize(action: ActionProposal) {
  const decision = propose(action);
  if (decision.execution_permit) return { decision, permit: decision.execution_permit, via: 'auto-allow' };
  if (decision.approval_request) {
    const grant = runtime.grantApproval({
      approval_request_id: decision.approval_request.approval_request_id, approver: 'operator',
    });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id, task_id: taskId, token: grant.token, action,
    });
    return { decision, permit: redemption.execution_permit, via: 'human-approved' };
  }
  return { decision, permit: undefined, via: 'denied' };
}

function repoint(link: string, target: string): void {
  unlinkSync(link);
  symlinkSync(target, link);
}

function writeAction(target: string, cwd?: string, content = 'PAYLOAD'): ActionProposal {
  return {
    action_kind: 'filesystem', operation: 'write', target, cwd,
    arguments: { content }, agent_id: 'attacker',
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repository on `main` with one commit and an unrelated `release` branch. */
function seedRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'governed@safeloop.test');
  git(dir, 'config', 'user.name', 'governed');
  writeFileSync(join(dir, 'seed.txt'), 'seed');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'seed');
  git(dir, 'branch', 'release');
}

function commitAction(cwd: string): ActionProposal {
  return {
    action_kind: 'git', operation: 'commit', cwd,
    arguments: { message: 'governed commit' }, agent_id: 'attacker',
  };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-bind-state-'));
  root = mkdtempSync(join(tmpdir(), 'safeloop-v02-bind-'));
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

describe('filesystem resolved-target binding', () => {
  it('signs the resolved target into the permit', () => {
    const dir = join(workspace, 'dir');
    mkdirSync(dir);
    const { permit } = authorize(writeAction('report.txt', dir));
    expect(permit?.resolved_target).toBe(join(dir, 'report.txt'));
  });

  it('A: refuses a swap into a sensitive sibling the policy engine denies outright', async () => {
    const benign = join(workspace, 'notes');
    const ssh = join(workspace, '.ssh');
    mkdirSync(benign); mkdirSync(ssh);
    const link = join(workspace, 'out');
    symlinkSync(benign, link);

    // Proposed directly, this destination is refused and never reaches an executor.
    expect(propose(writeAction(join(ssh, 'authorized_keys'), undefined, 'ssh-rsa AAAA attacker')).disposition)
      .toBe('DENY');

    // Proposed through the symlink it is ordinary in-workspace work.
    const action = writeAction(join(link, 'authorized_keys'), undefined, 'ssh-rsa AAAA attacker');
    const { decision, permit } = authorize(action);
    expect(decision.disposition).toBe('ALLOW');
    expect(permit).toBeDefined();

    repoint(link, ssh);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    expect(existsSync(join(ssh, 'authorized_keys'))).toBe(false);
    expect(existsSync(join(benign, 'authorized_keys'))).toBe(false);
  });

  it('B: refuses an outside→outside swap that would defeat an operator approval', async () => {
    const approved = join(root, 'deliverables');
    const victim = join(root, 'victim-config');
    mkdirSync(approved); mkdirSync(victim);
    writeFileSync(join(victim, 'settings.json'), '{"trusted":true}');
    const link = join(root, 'outbox');
    symlinkSync(approved, link);

    const action = writeAction(join(link, 'settings.json'), undefined, '{"owned":true}');
    const { decision, permit, via } = authorize(action);
    expect(decision.disposition).toBe('REQUIRE_APPROVAL');
    expect(via).toBe('human-approved');
    expect(permit).toBeDefined();

    repoint(link, victim);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    expect(existsSync(join(approved, 'settings.json'))).toBe(false);
    expect(readFileSync(join(victim, 'settings.json'), 'utf8')).toBe('{"trusted":true}');
  });

  it('C: refuses a swap one directory below a correctly verified cwd', async () => {
    const cwd = join(workspace, 'cwd');
    const good = join(workspace, 'good');
    const bad = join(workspace, 'bad');
    mkdirSync(cwd); mkdirSync(good); mkdirSync(bad);
    symlinkSync(good, join(cwd, 'out'));

    const action = writeAction('out/report.txt', cwd);
    const { permit } = authorize(action);
    // The cwd binding from the previous fix is intact and still correct; it is
    // the component below it that moved.
    expect(permit?.execution_cwd).toBe(cwd);
    expect(permit?.resolved_target).toBe(join(good, 'report.txt'));

    repoint(join(cwd, 'out'), bad);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    expect(existsSync(join(good, 'report.txt'))).toBe(false);
    expect(existsSync(join(bad, 'report.txt'))).toBe(false);
  });

  it('D: refuses a move whose destination ancestor was swapped', async () => {
    const good = join(workspace, 'good');
    const bad = join(workspace, 'bad');
    const src = join(workspace, 'src');
    mkdirSync(good); mkdirSync(bad); mkdirSync(src);
    writeFileSync(join(src, 'f.txt'), 'payload');
    const link = join(workspace, 'dlink');
    symlinkSync(good, link);

    const action: ActionProposal = {
      action_kind: 'filesystem', operation: 'move', target: join(src, 'f.txt'),
      arguments: { destination: join(link, 'f.txt') }, agent_id: 'attacker',
    };
    const { permit } = authorize(action);
    expect(permit?.resolved_destination).toBe(join(good, 'f.txt'));

    repoint(link, bad);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    // The source is the thing a failed move would have destroyed.
    expect(readFileSync(join(src, 'f.txt'), 'utf8')).toBe('payload');
    expect(existsSync(join(bad, 'f.txt'))).toBe(false);
    expect(existsSync(join(good, 'f.txt'))).toBe(false);
  });

  it('E: refuses a move whose source ancestor was swapped, and the wrong file stays put', async () => {
    // `move` resolves both ends in no-follow-final mode, so this covers the
    // other resolution mode as well as the other end of a dual-path operation.
    const good = join(workspace, 'good');
    const bad = join(workspace, 'bad');
    const dest = join(workspace, 'dest');
    mkdirSync(good); mkdirSync(bad); mkdirSync(dest);
    writeFileSync(join(good, 'f.txt'), 'expendable');
    writeFileSync(join(bad, 'f.txt'), 'precious');
    const link = join(workspace, 'link');
    symlinkSync(good, link);

    const action: ActionProposal = {
      action_kind: 'filesystem', operation: 'move', target: join(link, 'f.txt'),
      arguments: { destination: join(dest, 'f.txt') }, agent_id: 'attacker',
    };
    const { permit } = authorize(action);
    expect(permit?.resolved_target).toBe(join(good, 'f.txt'));

    repoint(link, bad);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    expect(readFileSync(join(bad, 'f.txt'), 'utf8')).toBe('precious');
    expect(readFileSync(join(good, 'f.txt'), 'utf8')).toBe('expendable');
    expect(existsSync(join(dest, 'f.txt'))).toBe(false);
  });

  it('E2: refuses a read redirected onto a file that was never authorized', async () => {
    // The same defect reads as well as writes: an authorization for one file
    // becomes disclosure of another.
    const benign = join(workspace, 'notes');
    const secrets = join(workspace, 'secrets');
    mkdirSync(benign); mkdirSync(secrets);
    writeFileSync(join(benign, 'notes.txt'), 'ordinary notes');
    writeFileSync(join(secrets, 'notes.txt'), 'PRIVATE-KEY-MATERIAL');
    const link = join(workspace, 'link');
    symlinkSync(benign, link);

    const action: ActionProposal = {
      action_kind: 'filesystem', operation: 'read', target: join(link, 'notes.txt'),
      arguments: {}, agent_id: 'attacker',
    };
    const { permit } = authorize(action);
    expect(permit).toBeDefined();

    repoint(link, secrets);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('target_context_changed');
    expect(result.stdout ?? '').not.toContain('PRIVATE-KEY-MATERIAL');
    expect(JSON.stringify(result.detail ?? {})).not.toContain('PRIVATE-KEY-MATERIAL');
  });

  it('F: fails closed when the permit carries no resolved target', async () => {
    const action = writeAction(join(workspace, 'a.txt'));
    const { permit } = authorize(action);
    const stripped = { ...(permit as unknown as Record<string, unknown>) };
    delete stripped.resolved_target;
    // Re-signing is not possible without the runtime secret, so this asserts the
    // signature covers the field rather than that the executor tolerates it.
    const result = await execute(stripped, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('permit_forged');
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false);
  });

  it('G: a tampered resolved_target is rejected as a forgery', async () => {
    const action = writeAction(join(workspace, 'a.txt'));
    const { permit } = authorize(action);
    const tampered = { ...(permit as unknown as Record<string, unknown>), resolved_target: join(workspace, 'b.txt') };
    const result = await execute(tampered, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('permit_forged');
    expect(existsSync(join(workspace, 'b.txt'))).toBe(false);
  });

  it('H: an unchanged target still executes, through a symlink and with a cwd', async () => {
    const real = join(workspace, 'real');
    mkdirSync(real);
    const link = join(workspace, 'link');
    symlinkSync(real, link);

    const viaLink = writeAction(join(link, 'a.txt'), undefined, 'ok');
    expect((await execute(authorize(viaLink).permit, viaLink)).status).toBe('EXECUTED');
    expect(readFileSync(join(real, 'a.txt'), 'utf8')).toBe('ok');

    const relative = writeAction('b.txt', link, 'ok');
    expect((await execute(authorize(relative).permit, relative)).status).toBe('EXECUTED');
    expect(readFileSync(join(real, 'b.txt'), 'utf8')).toBe('ok');
  });

  it('I: a not-yet-existing nested target still executes', async () => {
    // Resolution walks up to the nearest existing ancestor, so a path whose
    // parents are created by the write itself must still match.
    const action = writeAction(join(workspace, 'a', 'b', 'c.txt'), undefined, 'ok');
    const { permit } = authorize(action);
    expect(permit?.resolved_target).toBe(join(workspace, 'a', 'b', 'c.txt'));
    expect((await execute(permit, action)).status).toBe('EXECUTED');
    expect(readFileSync(join(workspace, 'a', 'b', 'c.txt'), 'utf8')).toBe('ok');
  });

  it('J: a genuine boundary crossing is still reported as a relation change', async () => {
    // Ordering matters: the resolved-path check must not mask the coarser
    // diagnosis an operator acts on.
    const inside = join(workspace, 'real');
    const outside = join(root, 'outside');
    mkdirSync(inside); mkdirSync(outside);
    const link = join(workspace, 'link');
    symlinkSync(inside, link);

    const action = writeAction(join(link, 'a.txt'));
    const { permit } = authorize(action);

    repoint(link, outside);
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('workspace_relation_changed');
    expect(existsSync(join(outside, 'a.txt'))).toBe(false);
  });
});

// -------------------------------------------------------------- GIT ------

describe('git HEAD binding', () => {
  it('signs HEAD into the permit', () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    const { permit } = authorize(commitAction(repo));
    expect(permit?.head_ref).toBe('refs/heads/main');
    expect(permit?.head_commit).toBe(git(repo, 'rev-parse', 'HEAD').trim());
  });

  it('A: refuses a commit after HEAD is re-pointed at another branch', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    expect(permit).toBeDefined();
    const releaseBefore = git(repo, 'rev-parse', 'release').trim();
    const mainBefore = git(repo, 'rev-parse', 'main').trim();

    git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/release');
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('repository_context_changed');
    expect(git(repo, 'rev-parse', 'release').trim()).toBe(releaseBefore);
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(mainBefore);
  });

  it('B: refuses a commit in a linked worktree whose HEAD was re-pointed', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    const wt = join(workspace, 'wt');
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'feature');
    writeFileSync(join(wt, 'x.txt'), 'payload');
    git(wt, 'add', '.');

    const action = commitAction(wt);
    const { permit } = authorize(action);
    expect(permit?.head_ref).toBe('refs/heads/feature');
    const releaseBefore = git(repo, 'rev-parse', 'release').trim();

    git(wt, 'symbolic-ref', 'HEAD', 'refs/heads/release');
    const result = await execute(permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('repository_context_changed');
    expect(git(repo, 'rev-parse', 'release').trim()).toBe(releaseBefore);
  });

  it('C: refuses when HEAD moves on the authorized branch', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);

    // A concurrent commit advances the branch the permit was issued against.
    git(repo, 'commit', '-q', '-m', 'concurrent');
    const headAfterConcurrent = git(repo, 'rev-parse', 'HEAD').trim();

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('repository_context_changed');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(headAfterConcurrent);
  });

  it('D: refuses when a detached HEAD is checked out onto a branch at the same commit', async () => {
    // The commit object is unchanged, so binding it alone would compare equal
    // while the commit lands on a branch instead of nowhere.
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    git(repo, 'checkout', '-q', '--detach', 'HEAD');
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    expect(permit?.head_ref).toBeUndefined();
    expect(permit?.head_commit).toBe(git(repo, 'rev-parse', 'HEAD').trim());

    const mainBefore = git(repo, 'rev-parse', 'main').trim();
    git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');

    const result = await execute(permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('repository_context_changed');
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(mainBefore);
  });

  it('E: allows a commit on a detached HEAD that has not moved', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    git(repo, 'checkout', '-q', '--detach', 'HEAD');
    const detachedAt = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    const result = await execute(permit, action);

    expect(result.status).toBe('EXECUTED');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).not.toBe(detachedAt);
    // Still detached, and no branch was moved.
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(detachedAt);
  });

  it('F: allows a commit on an unborn branch', async () => {
    const repo = join(workspace, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'governed@safeloop.test');
    git(repo, 'config', 'user.name', 'governed');
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    expect(permit?.head_ref).toBe('refs/heads/main');
    expect(permit?.head_commit).toBeUndefined();

    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
  });

  it('G: a read is unaffected by a concurrent checkout', async () => {
    // HEAD binding must not turn a legitimate concurrent checkout into a
    // refusal for operations whose result does not depend on HEAD.
    const repo = join(workspace, 'repo');
    seedRepo(repo);

    const action: ActionProposal = {
      action_kind: 'git', operation: 'status', cwd: repo,
      arguments: {}, agent_id: 'attacker',
    };
    const { permit } = authorize(action);

    git(repo, 'checkout', '-q', 'release');
    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
  });

  it('H: an unchanged HEAD still commits', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    const mainBefore = git(repo, 'rev-parse', 'main').trim();

    const result = await execute(permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(git(repo, 'rev-parse', 'main').trim()).not.toBe(mainBefore);
  });

  it('I: a tampered head_ref is rejected as a forgery', async () => {
    const repo = join(workspace, 'repo');
    seedRepo(repo);
    writeFileSync(join(repo, 'x.txt'), 'payload');
    git(repo, 'add', '.');

    const action = commitAction(repo);
    const { permit } = authorize(action);
    const mainBefore = git(repo, 'rev-parse', 'main').trim();

    git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/release');
    const tampered = { ...(permit as unknown as Record<string, unknown>), head_ref: 'refs/heads/release' };
    const result = await execute(tampered, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('permit_forged');
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(mainBefore);
  });
});
