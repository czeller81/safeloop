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

The current implementation supports a basic approval lifecycle. Rich approval stores, signatures, and external identity-provider integration are future work.

## Expired Or Missing Approval

Runtime policy treats expired approval context as approval-required. Integrations should not execute consequential actions when approval is missing, denied, or expired.

## Boundary

Approval cannot stop actions that bypass SafeLoop. Agents, MCP hosts, connectors, and local tools must route consequential actions through SafeLoop for approval gates to apply.
