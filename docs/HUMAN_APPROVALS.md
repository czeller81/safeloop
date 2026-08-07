# Human Approvals

SafeLoop uses human approval to hold consequential actions before execution.

Examples of approval-worthy actions:

- commit and push
- production deploy
- publish
- delete
- send external communication
- change permissions
- execute payment or purchase
- modify infrastructure
- access sensitive data
- override policy
- write durable high-impact memory

## Existing Approval Surfaces

- `createCommandGuard()` returns `requires_approval` without executing.
- MCP `safeloop.checkCommand` and `safeloop.runCommand` return approval-required decisions.
- Case files can request and resolve approvals.
- The monitor dashboard displays approval pressure and inspector details.
- Runtime policy returns `REQUIRE_APPROVAL` for high-risk or configured actions.
- `createApprovalGate()` issues and redeems hardened approval tokens for integrations that need explicit approval authorization.
- `createCommandGuard()` can redeem a valid approval token before executing an approval-required command when configured with an approval gate.

## Hardened Approval Tokens

`createApprovalGate()` issues HMAC-SHA256-signed tokens bound to the exact approval context:

- action
- target
- arguments hash or fingerprint
- task
- session
- tenant
- agent
- environment
- expiration time

Tokens are single-use. Successful redemption consumes the token. `revoke()` also consumes a token ID so later redemption fails. The default state store is in-memory for local development; `createLocalApprovalStateStore()` preserves consumed and revoked token IDs across process restart.

Invalid approvals fail before consequential execution when the integration checks redemption before running the action. Covered cases include forged signatures, expiration, reuse, revocation, and context mismatches.

```typescript
import { createApprovalGate, createLocalApprovalStateStore } from 'safeloop';

const baseDir = '/var/lib/safeloop';
const approvals = createApprovalGate({
  ttlMs: 5 * 60 * 1000,
  secret: process.env.SAFELOOP_APPROVAL_SECRET,
  storageOptions: { baseDir },
  stateStore: createLocalApprovalStateStore({ baseDir }),
});

const token = approvals.issue({
  action: 'deploy',
  target: 'production',
  argumentsHash: 'sha256-of-normalized-arguments',
  taskId: 'task-123',
  sessionId: 'session-123',
  tenantId: 'district-001',
  agentId: 'hermes',
  environment: 'production',
  reason: 'Release approved by operator',
  requestedBy: 'hermes',
}, 'operator-1');

const redemption = approvals.redeem(token, {
  action: 'deploy',
  target: 'production',
  argumentsHash: 'sha256-of-normalized-arguments',
  taskId: 'task-123',
  sessionId: 'session-123',
  tenantId: 'district-001',
  agentId: 'hermes',
  environment: 'production',
});

if (!redemption.valid) {
  // Do not execute the action.
}
```

## Approval Object Guidance

Approval records should include:

- approval ID
- requested agent
- action and target
- reason
- risk
- supporting evidence
- expected impact
- expiration
- approver identity
- decision
- decision timestamp
- comments

The current implementation supports a hardened approval lifecycle with optional local durable replay state. External identity-provider integration is deployment work outside the local SafeLoop engine.

## Approval-Aware Command Execution

`createCommandGuard()` can be configured with an approval gate. When policy requires approval, the guard will not execute without a valid approval token bound to the command context. Missing, expired, forged, revoked, reused, or context-mismatched tokens return `requires_approval` and do not reach `spawnSync`.

```typescript
import { createApprovalGate, createCommandGuard, createLocalApprovalStateStore } from 'safeloop';

const baseDir = '.safeloop';
const approvalGate = createApprovalGate({
  secret: process.env.SAFELOOP_APPROVAL_SECRET,
  storageOptions: { baseDir },
  stateStore: createLocalApprovalStateStore({ baseDir }),
});

const guard = createCommandGuard({
  policy: {
    oversightMode: 'HOTL',
    requireApprovalFor: ['deploy'],
  },
  caseId: 'case-123',
  sessionId: 'session-123',
  agentId: 'hermes',
  storageOptions: { baseDir },
  approvalGate,
});

const token = approvalGate.issue({
  action: 'deploy',
  target: process.cwd(),
  argumentsHash: '',
  taskId: 'case-123',
  sessionId: 'session-123',
  tenantId: 'district-001',
  agentId: 'hermes',
  environment: 'local',
  reason: 'Operator approved deployment',
  requestedBy: 'hermes',
}, 'operator-1');

const result = guard.run('deploy', {
  approvalToken: token,
  approvalContext: {
    taskId: 'case-123',
    sessionId: 'session-123',
    tenantId: 'district-001',
    agentId: 'hermes',
    environment: 'local',
  },
});

if (!result.executed) {
  // The command did not run.
}
```

## Expired Or Missing Approval

Runtime policy treats expired approval context as approval-required. Integrations should not execute consequential actions when approval is missing, denied, or expired.

## Boundary

Approval cannot stop actions that bypass SafeLoop. Agents, MCP hosts, connectors, and local tools must route consequential actions through SafeLoop for approval gates to apply.
