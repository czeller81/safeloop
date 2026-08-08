/**
 * SL-RC1-HIGH-001 — filesystem workspace proposal→execution TOCTOU.
 *
 * RC1 bound authorization to a *pathname* and to a workspace classification
 * computed at proposal time. Symlinks are mutable, so the same pathname could
 * resolve somewhere else by the time the permit was redeemed, and the executor
 * wrote to the approved path string without rechecking. An independent audit
 * demonstrated a write escaping the workspace with `status: EXECUTED`.
 *
 * Every test here asserts BOTH the decision/status AND the absence of the side
 * effect. A rejection that still wrote the file would be worthless.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSafeloopRuntime, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { verifyContainment } from '../src/runtime/workspace';
import type { ActionProposal } from '../src/runtime/protocol';

let baseDir: string;
let root: string;
let workspace: string;
let insideDir: string;
let outsideDir: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;
let taskId: string;

function fsAction(target: string, operation = 'create', args: Record<string, unknown> = { content: 'payload' }): ActionProposal {
  return { action_kind: 'filesystem', operation, target, arguments: args, agent_id: 'attacker' };
}

function propose(action: ActionProposal) {
  return runtime.propose(handle.credential, { session_id: handle.session.session_id, task_id: taskId, action });
}

function execute(permit: unknown, action: ActionProposal) {
  return runtime.execute(handle.credential, {
    session_id: handle.session.session_id, permit: permit as never, action,
  });
}

/** Swap a symlink so the same pathname resolves somewhere new. */
function repoint(link: string, target: string): void {
  unlinkSync(link);
  symlinkSync(target, link);
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-toctou-state-'));
  root = mkdtempSync(join(tmpdir(), 'safeloop-v02-toctou-'));
  workspace = join(root, 'workspace');
  insideDir = join(workspace, 'real');
  outsideDir = join(root, 'outside');
  mkdirSync(insideDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding', workspace });
  handle = runtime.startSession({ agent: { agent_id: 'attacker' }, tenant_id: 'tenant-a', workspace, profile: 'coding' });
  taskId = runtime.startTask(handle.credential, { session_id: handle.session.session_id }).task_id;
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// TEST A — the exact independently reproduced attack
describe('A: direct parent symlink swap', () => {
  it('refuses the write and creates nothing outside the workspace', async () => {
    symlinkSync(insideDir, join(workspace, 'link'));
    const action = fsAction(join(workspace, 'link', 'pwned.txt'), 'create', { content: 'outside-write' });

    const decision = propose(action);
    expect(decision.disposition).toBe('ALLOW');
    expect(decision.execution_permit).toBeDefined();
    expect(decision.execution_permit?.workspace_relation).toBe('inside');

    repoint(join(workspace, 'link'), outsideDir);

    const result = await execute(decision.execution_permit, action);

    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('workspace_relation_changed');
    expect(existsSync(join(outsideDir, 'pwned.txt'))).toBe(false);
    expect(existsSync(join(insideDir, 'pwned.txt'))).toBe(false);
  });

  it('reports both the authorized and the execution-time relation', async () => {
    symlinkSync(insideDir, join(workspace, 'link'));
    const action = fsAction(join(workspace, 'link', 'evidence.txt'));
    const decision = propose(action);
    repoint(join(workspace, 'link'), outsideDir);

    const result = await execute(decision.execution_permit, action);
    expect(result.detail).toMatchObject({ authorized_relation: 'inside', execution_relation: 'outside' });
  });
});

// TEST B — swap an ancestor further up the chain
describe('B: nested ancestor symlink swap', () => {
  it('refuses when a grandparent component is repointed', async () => {
    const deepInside = join(insideDir, 'a', 'b');
    mkdirSync(deepInside, { recursive: true });
    symlinkSync(insideDir, join(workspace, 'mid'));

    const action = fsAction(join(workspace, 'mid', 'a', 'b', 'nested.txt'));
    const decision = propose(action);
    expect(decision.execution_permit).toBeDefined();

    const outsideDeep = join(outsideDir, 'a', 'b');
    mkdirSync(outsideDeep, { recursive: true });
    repoint(join(workspace, 'mid'), outsideDir);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDeep, 'nested.txt'))).toBe(false);
  });
});

// TEST C — final component itself becomes a symlink pointing out
describe('C: existing target replaced by an escaping symlink', () => {
  it('refuses a write whose final component now points outside', async () => {
    const target = join(insideDir, 'notes.txt');
    writeFileSync(target, 'original');

    const action = fsAction(target, 'write', { content: 'redirected' });
    const decision = propose(action);
    expect(decision.execution_permit).toBeDefined();

    unlinkSync(target);
    symlinkSync(join(outsideDir, 'stolen.txt'), target);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'stolen.txt'))).toBe(false);
  });

  it('refuses a read redirected outside after authorization', async () => {
    const secret = join(outsideDir, 'secret.txt');
    writeFileSync(secret, 'classified');
    const target = join(insideDir, 'readable.txt');
    writeFileSync(target, 'ordinary');

    const action = fsAction(target, 'read', {});
    const decision = propose(action);

    unlinkSync(target);
    symlinkSync(secret, target);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.stdout ?? '').not.toContain('classified');
  });
});

// TEST D — the fix must not break ordinary managed usage
describe('D: unchanged in-workspace operations still succeed', () => {
  it('writes normally when nothing moves', async () => {
    const target = join(insideDir, 'ordinary.txt');
    const action = fsAction(target, 'create', { content: 'ordinary work' });
    const decision = propose(action);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(target, 'utf8')).toBe('ordinary work');
  });

  it('writes through a stable in-workspace symlink', async () => {
    // A symlink that does not move is legitimate and must keep working.
    symlinkSync(insideDir, join(workspace, 'stable'));
    const action = fsAction(join(workspace, 'stable', 'via-link.txt'), 'create', { content: 'through a link' });
    const decision = propose(action);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(join(insideDir, 'via-link.txt'), 'utf8')).toBe('through a link');
  });

  it('reads, lists, and stats normally', async () => {
    writeFileSync(join(insideDir, 'r.txt'), 'content');
    for (const [operation, target] of [['read', join(insideDir, 'r.txt')], ['list', insideDir], ['stat', join(insideDir, 'r.txt')]] as const) {
      const action = fsAction(target, operation, {});
      const decision = propose(action);
      const result = await execute(decision.execution_permit, action);
      expect({ operation, status: result.status }).toEqual({ operation, status: 'EXECUTED' });
    }
  });
});

// TEST E — legitimately authorized outside-workspace actions must still work
describe('E: explicitly authorized outside-workspace action', () => {
  it('executes when approved as outside and still outside', async () => {
    const target = join(outsideDir, 'approved.txt');
    const action = fsAction(target, 'create', { content: 'approved outside' });

    const decision = propose(action);
    expect(decision.disposition).toBe('REQUIRE_APPROVAL');

    const grant = runtime.grantApproval({
      approval_request_id: decision.approval_request!.approval_request_id, approver: 'operator',
    });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id, task_id: taskId, token: grant.token, action,
    });
    expect(redemption.execution_permit?.workspace_relation).toBe('outside');

    const result = await execute(redemption.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(target, 'utf8')).toBe('approved outside');
  });

  it('refuses when an outside-authorized target is redirected back inside', async () => {
    // Not an escalation in policy severity, but it is not the object the human
    // approved. The relation must be unchanged, not merely no-worse.
    const outsideLink = join(outsideDir, 'link');
    const outsideReal = join(outsideDir, 'real');
    mkdirSync(outsideReal, { recursive: true });
    symlinkSync(outsideReal, outsideLink);

    const action = fsAction(join(outsideLink, 'moved.txt'), 'create', { content: 'x' });
    const decision = propose(action);
    const grant = runtime.grantApproval({
      approval_request_id: decision.approval_request!.approval_request_id, approver: 'operator',
    });
    const redemption = runtime.redeemApproval(handle.credential, {
      session_id: handle.session.session_id, task_id: taskId, token: grant.token, action,
    });

    repoint(outsideLink, insideDir);

    const result = await execute(redemption.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('workspace_relation_changed');
    expect(existsSync(join(insideDir, 'moved.txt'))).toBe(false);
  });
});

// Dual-path operations
describe('dual-path operations are protected at both ends', () => {
  it('refuses a move whose destination is redirected outside', async () => {
    const source = join(insideDir, 'movable.txt');
    writeFileSync(source, 'movable');
    symlinkSync(insideDir, join(workspace, 'dest'));

    const action = fsAction(source, 'move', { destination: join(workspace, 'dest', 'moved.txt') });
    const decision = propose(action);
    expect(decision.execution_permit).toBeDefined();

    repoint(join(workspace, 'dest'), outsideDir);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(existsSync(join(outsideDir, 'moved.txt'))).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('refuses a move whose source is redirected outside', async () => {
    const outsideVictim = join(outsideDir, 'victim.txt');
    writeFileSync(outsideVictim, 'do not move me');
    const sourceLink = join(workspace, 'src');
    mkdirSync(join(insideDir, 'srcdir'), { recursive: true });
    writeFileSync(join(insideDir, 'srcdir', 'f.txt'), 'inside');
    symlinkSync(join(insideDir, 'srcdir'), sourceLink);

    const action = fsAction(join(sourceLink, 'f.txt'), 'move', { destination: join(insideDir, 'dst.txt') });
    const decision = propose(action);

    repoint(sourceLink, outsideDir);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(readFileSync(outsideVictim, 'utf8')).toBe('do not move me');
  });

  it('performs a legitimate unchanged move', async () => {
    const source = join(insideDir, 'a.txt');
    writeFileSync(source, 'move me');
    const action = fsAction(source, 'move', { destination: join(insideDir, 'b.txt') });
    const decision = propose(action);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(readFileSync(join(insideDir, 'b.txt'), 'utf8')).toBe('move me');
  });
});

// delete must not follow the final symlink
describe('delete acts on the entry, not on what it points to', () => {
  it('refuses to delete through a symlink repointed outside', async () => {
    const outsideVictim = join(outsideDir, 'keep.txt');
    writeFileSync(outsideVictim, 'intact');
    const doomed = join(insideDir, 'doomed');
    mkdirSync(doomed, { recursive: true });
    writeFileSync(join(doomed, 'f.txt'), 'x');
    symlinkSync(doomed, join(workspace, 'dlink'));

    const action = fsAction(join(workspace, 'dlink', 'f.txt'), 'delete', {});
    const decision = propose(action);

    repoint(join(workspace, 'dlink'), outsideDir);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(readFileSync(outsideVictim, 'utf8')).toBe('intact');
  });
});

// Fail-closed on unverifiable state
describe('unverifiable containment fails closed', () => {
  it('still executes when the workspace is merely recreated at the same location', async () => {
    // Deleting and recreating a directory is ordinary work (`rm -rf dist` then
    // writing into it again). The bytes still land at the authorized path
    // inside the workspace, so refusing here would be a functional regression
    // rather than a security win. What matters is that nothing lands outside.
    const target = join(insideDir, 'orphan.txt');
    const action = fsAction(target);
    const decision = propose(action);

    rmSync(workspace, { recursive: true, force: true });

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('EXECUTED');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(outsideDir, 'orphan.txt'))).toBe(false);
  });

  it('refuses when the workspace root itself is swapped for a symlink outside', async () => {
    // Found while writing these tests: replacing the workspace *directory*
    // moves the target and the root together, so containment still reads
    // "inside" while the bytes land elsewhere. The permit therefore also binds
    // the resolved workspace root.
    mkdirSync(join(outsideDir, 'real'), { recursive: true });
    const target = join(insideDir, 'rootswap.txt');
    const action = fsAction(target, 'create', { content: 'escaped' });
    const decision = propose(action);
    expect(decision.execution_permit?.workspace_root).toBeDefined();

    rmSync(workspace, { recursive: true, force: true });
    symlinkSync(outsideDir, workspace);

    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('workspace_relation_changed');
    expect(existsSync(join(outsideDir, 'real', 'rootswap.txt'))).toBe(false);
  });

  it('refuses an unresolvable symlink loop rather than guessing', async () => {
    const loopA = join(insideDir, 'loop-a');
    const loopB = join(insideDir, 'loop-b');
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);

    const action = fsAction(join(loopA, 'file.txt'));
    const decision = propose(action);
    if (!decision.execution_permit) {
      // Policy already refused the unresolvable path — also fail-closed.
      expect(decision.allowed).toBe(false);
      return;
    }
    const result = await execute(decision.execution_permit, action);
    expect(result.status).toBe('REJECTED');
  });

  it('refuses when the permit carries no authorized workspace facts', async () => {
    // A permit without the signed relation and root cannot be compared
    // against, so there is no authorization fact to honour. Fail closed.
    const target = join(insideDir, 'norelation.txt');
    const action = fsAction(target);
    const decision = propose(action);

    const permits = runtime.permits();
    const bare = permits.issue({
      action_fingerprint: decision.action_fingerprint,
      agent_id: 'attacker', task_id: taskId, session_id: handle.session.session_id,
      scenario_id: 'coding', tenant_id: 'tenant-a', disposition: 'ALLOW',
      // workspace_relation and workspace_root deliberately omitted
    });

    const result = await execute(bare, action);
    expect(result.status).toBe('REJECTED');
    expect(result.rejection_reason).toBe('workspace_verification_failed');
    expect(existsSync(target)).toBe(false);
  });
});

// A rejected execution must still have spent its permit
describe('permit consumption semantics', () => {
  it('does not allow a permit rejected on containment to be retried', async () => {
    symlinkSync(insideDir, join(workspace, 'retry'));
    const action = fsAction(join(workspace, 'retry', 'x.txt'));
    const decision = propose(action);

    repoint(join(workspace, 'retry'), outsideDir);
    const first = await execute(decision.execution_permit, action);
    expect(first.rejection_reason).toBe('workspace_relation_changed');

    // Restore the safe target and retry the same permit: it is already spent,
    // so the containment refusal cannot be walked back by fixing the symlink.
    repoint(join(workspace, 'retry'), insideDir);
    const second = await execute(decision.execution_permit, action);
    expect(second.status).toBe('REJECTED');
    expect(second.rejection_reason).toBe('permit_consumed');
    expect(existsSync(join(insideDir, 'x.txt'))).toBe(false);
  });
});

describe('verifyContainment primitive', () => {
  it('classifies a symlink escape as outside and resolves the real path', () => {
    symlinkSync(outsideDir, join(workspace, 'esc'));
    const result = verifyContainment(join(workspace, 'esc', 'f.txt'), workspace, workspace, 'follow');
    expect(result.relation).toBe('outside');
    expect(result.verifiable).toBe(true);
    expect(result.resolved.startsWith(outsideDir)).toBe(true);
  });

  it('resolves relative and .. spellings to the same answer', () => {
    const direct = verifyContainment(join(insideDir, 'f.txt'), workspace, workspace, 'follow');
    const dotted = verifyContainment(join(insideDir, '..', 'real', 'f.txt'), workspace, workspace, 'follow');
    const relative = verifyContainment('real/f.txt', workspace, workspace, 'follow');
    expect(dotted.resolved).toBe(direct.resolved);
    expect(relative.resolved).toBe(direct.resolved);
  });

  it('keeps the final component literal in no_follow_final mode', () => {
    symlinkSync(outsideDir, join(insideDir, 'leaf'));
    const follow = verifyContainment(join(insideDir, 'leaf'), workspace, workspace, 'follow');
    const noFollow = verifyContainment(join(insideDir, 'leaf'), workspace, workspace, 'no_follow_final');
    expect(follow.relation).toBe('outside');
    expect(noFollow.relation).toBe('inside');
  });

  it('reports unverifiable when no target is supplied', () => {
    expect(verifyContainment(undefined, workspace, workspace).verifiable).toBe(false);
  });
});
