# Human Approvals

SafeLoop uses human approval to hold consequential actions before execution.

## Who may approve — the trust boundary

**The agent credential cannot grant approvals. Only the operator credential
can.** These are two different secrets in two different files, and neither is a
stronger form of the other:

| Credential | Held by | File | Grants |
| --- | --- | --- | --- |
| runtime | the agent / adapter | `runtime-credential.json` | propose, redeem, execute — **not** approve |
| operator | the human | `operator-credential.json` | approve — **and nothing else** |

Until v0.2 RC3 both roles used one credential, so an agent could approve its own
held actions: propose, grant, redeem, execute, with a free-text `approver`
string recorded as though a person had decided. The `approver` field is a label
for the ledger; it has never been an authorization, and it is not one now. What
authorizes is possession of the operator credential.

The operator credential is created on first daemon start, written `0600` to the
runtime state directory, classified as a sensitive path so a governed
`filesystem read` of it is refused, absent from the connection file the agent
reads, and **persistent across restarts** — it is a standing human credential,
not a per-process connection detail.

Approve with:

```
safeloop approve <approval_request_id> [--approver <name>]
```

or from any process that holds the operator credential. See
`docs/ADAPTER_SPEC.md` for why an adapter must never do this itself.

### One decision, one execution

A granted request cannot be granted again. A second `grantApproval` for the
same `approval_request_id` fails with `approval_already_granted` (HTTP 409).
Previously each grant minted an independently redeemable token, so one human
decision could authorize an unbounded number of executions. If an action needs
to run again, it is proposed again and decided again.

### Migrating an existing deployment

Deployments that used the single runtime credential for everything will see
`401` on `/v1/approval/grant` after upgrading. This break is the fix; do not
work around it by handing the operator credential to the agent.

1. Start the daemon once. `operator-credential.json` is created automatically
   and its path is printed by `safeloop daemon start --foreground`.
2. Give that credential to whatever performs the human approval step — an
   operator CLI session, a dashboard, or an approval service. Do **not** put it
   in the agent's environment, image, or config.
3. Remove any `grantApproval` call from your adapter and replace it with
   waiting on the out-of-band channel.
4. If you provision credentials yourself, pass `operatorCredential` to
   `startDaemon`; it must not equal the runtime `credential`.

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
