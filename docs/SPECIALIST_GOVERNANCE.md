# SafeLoop Specialist Governance

SafeLoop specialist governance is a focused policy layer for routing agent work, checking specialist tool permissions, recording delegated execution evidence, validating specialist reviews, and reporting effect guard coverage.

It is local-first and cooperative. It does not replace OS sandboxing, and it does not claim universal interception.

## Enforcement Boundary

SafeLoop records and mediates effects routed through:

- `guardEffect`
- MCP gateway tools such as `safeloop.checkCommand` and `safeloop.runCommand`
- `createCommandGuard().run()`
- scenario-loop command steps
- connector or runtime adapters that explicitly call SafeLoop before performing an effect

SafeLoop does not universally intercept private tools, direct file edits, direct API calls, publishing, messaging, deployments, shell commands, or other side effects unless those paths integrate with SafeLoop.

Use OS-level sandboxing, containers, VMs, endpoint controls, or platform policy controls when non-cooperative containment is required.

## Specialist Routing

Use `routeSpecialistTask` to deterministically select a specialist from an objective.

```typescript
import { routeSpecialistTask } from 'safeloop';

const route = routeSpecialistTask({
  objective: 'Run a four-video visual-only MCP pipeline for the Video Director project',
});

console.log(route.specialistId); // video_director
```

Video and media objectives route to `video_director` when they include signals such as:

- video analysis
- media files
- scene or shot detection
- transcription
- proxy generation
- edit planning
- captions
- quality control
- rendering
- Video Director MCP tools

Infrastructure support can be delegated without changing the primary specialist:

```typescript
const route = routeSpecialistTask({
  objective: 'Generate proxies for a video review pipeline',
  requiresInfrastructureSupport: true,
  preferredSupportSpecialist: 'coding',
});

console.log(route.specialistId); // video_director
console.log(route.delegatedSupport); // coding
```

This keeps the product/domain owner as `video_director` while allowing narrowly scoped terminal-backed support by `coding` or `operations`.

## Specialist Permissions

Use `validateSpecialistTool` for a direct capability check.

```typescript
import { validateSpecialistTool } from 'safeloop';

const result = validateSpecialistTool('sales', 'terminal');

console.log(result.allowed); // false
console.log(result.reasonCodes); // ['specialist-tool-not-permitted']
```

Current specialist tool model:

| Specialist | Tools |
|------------|-------|
| `video_director` | `video_mcp`, `analysis` |
| `coding` | `terminal`, `filesystem`, `analysis` |
| `operations` | `terminal`, `filesystem`, `analysis` |
| `sales` | `analysis`, `messaging` |
| `general` | `analysis` |

`coding`, `operations`, and `video_director` permissions are still evaluated in context. The tool may be allowed for the specialist while the action is denied or held for approval because of command risk, production environment, target, or authorization-context mismatch.

Use `evaluateSpecialistAction` when SafeLoop needs to infer the required tool from the action and apply policy ordering.

```typescript
import { evaluateSpecialistAction } from 'safeloop';

const decision = evaluateSpecialistAction({
  specialistId: 'sales',
  actionKind: 'analysis',
  command: 'npm test',
  environment: 'development',
});

console.log(decision.decision); // DENY
console.log(decision.tool); // terminal
console.log(decision.reasonCodes); // ['specialist-tool-not-permitted']
```

Development mode does not override denied tool permissions. If a command requires terminal execution and the specialist cannot use `terminal`, the result is `DENY`.

MCP `safeloop.checkCommand` and `safeloop.runCommand` share this specialist permission evaluation when `specialistId` is supplied. The preflight and execution paths should not disagree.

## Delegation and Authorization Binding

Use `delegateSpecialistStep` when one specialist owns the workflow but another specialist must execute a narrow support step.

```typescript
import { delegateSpecialistStep } from 'safeloop';

const delegated = delegateSpecialistStep({
  fromSpecialistId: 'video_director',
  toSpecialistId: 'coding',
  taskId: 'video-task-1',
  executionPlanId: 'plan-1',
  stepId: 'proxy-setup',
  reason: 'Proxy generation requires terminal-backed setup',
  tool: 'terminal',
  command: 'npm test',
  environment: 'development',
});

console.log(delegated.authorizationToken);
```

The delegated authorization is bound to the execution context:

- `specialistId`
- `taskId`
- `executionPlanId`
- `stepId`
- `tool`
- `environment`
- `target`
- `command`

If a caller reuses an authorization token after changing specialist identity or another bound field, `evaluateSpecialistAction` returns `DENY` with `authorization-context-mismatch`.

Delegation records a `specialist.delegated` audit event with the source specialist, target specialist, task, execution plan, step, reason, tool, decision, and authorization token.

## Review Workflow

Use `reviewSpecialistResult` to record a specialist review.

Minimal valid review:

```typescript
import { reviewSpecialistResult } from 'safeloop';

const review = reviewSpecialistResult({
  specialistId: 'video_director',
  reviewerId: 'malu',
  status: 'approved',
  summary: 'Visual review completed.',
  recommendedNextStep: 'Proceed with guarded proxy generation.',
});

console.log(review.ok); // true
```

Extended review:

```typescript
reviewSpecialistResult({
  specialistId: 'coding',
  reviewerId: 'malu',
  status: 'needs_changes',
  summary: 'Implementation needs another pass.',
  buildResults: [],
  testsRun: [{ name: 'unit', status: 'passed' }],
  unresolvedIssues: [{ severity: 'medium', summary: 'Missing fixture evidence' }],
  artifacts: [],
  evidence: [],
  recommendedNextStep: 'Attach fixture evidence and rerun tests.',
});
```

Optional structured fields are preserved when provided. Fields that do not apply can be omitted or supplied as empty arrays.

Invalid reviews return field-level validation errors:

```typescript
const invalid = reviewSpecialistResult({
  specialistId: 'coding',
  status: 'approved',
  summary: 'Missing reviewer and next step',
});

console.log(invalid.ok); // false
console.log(invalid.errors);
```

Each validation error includes:

- `field`
- `expectedType`
- `required`
- `message`

Successful reviews record a `specialist.reviewed` audit event.

## Effect Guard Coverage

Use `createEffectGuard` to mediate externally meaningful effects through registered adapters.

```typescript
import { createEffectGuard } from 'safeloop';

const effects = createEffectGuard({
  registeredAdapters: ['terminal_execute'],
  expectedAdapters: ['terminal_execute', 'deploy'],
});
```

Supported effect classes:

- `filesystem_write`
- `filesystem_delete`
- `terminal_execute`
- `external_api_call`
- `external_message`
- `publish`
- `deploy`
- `credential_change`
- `dns_change`
- `purchase`
- `database_write`
- `production_change`

Guard an effect:

```typescript
const result = effects.guardEffect({
  specialistId: 'coding',
  effectClass: 'terminal_execute',
  action: 'run local verification',
  environment: 'development',
  target: 'npm test',
  execute: () => 'ok',
});

console.log(result.status); // allowed
console.log(result.executed); // true
```

Read coverage diagnostics:

```typescript
const coverage = effects.status();

console.log(coverage.registeredAdapters);
console.log(coverage.expectedAdapters);
console.log(coverage.knownCoverageGaps);
console.log(coverage.boundary);
```

`registeredAdapters` are effect classes currently mediated by an integration. `expectedAdapters` are effect classes SafeLoop expects to be mediated in this context. `knownCoverageGaps` are effect classes without registered adapters.

If an adapter is expected but missing for a production-impacting effect, SafeLoop fails closed:

```typescript
const effects = createEffectGuard({
  registeredAdapters: [],
  expectedAdapters: ['deploy'],
});

const deploy = effects.guardEffect({
  specialistId: 'operations',
  effectClass: 'deploy',
  action: 'deploy production',
  environment: 'production',
  execute: () => 'should-not-run',
});

console.log(deploy.decision); // DENY
console.log(deploy.status); // blocked
console.log(deploy.executed); // false
```

Effect decisions are recorded as `effect.evaluated` events.

## CommandGuard Diagnostics

`CommandGuard` uses `spawnSync` for process execution. Guarded execution results include:

- `stdout`
- `stderr`
- `exitCode`
- `signal`
- `cwd`
- `startedAt`
- `completedAt`
- `durationMs`
- `timedOut`
- `spawnError`
- `failureKind`

`failureKind` distinguishes:

- `policy_denied`
- `approval_required`
- `spawn_failed`
- `process_nonzero`
- `process_timeout`
- `process_succeeded`

This lets callers distinguish a policy denial from a spawn failure, timeout, nonzero process exit, or successful command.

## MCP Integration

When `specialistId` is included in MCP input, `safeloop.checkCommand` and `safeloop.runCommand` use the same specialist permission evaluation.

```typescript
const check = gateway.checkCommand({
  specialistId: 'sales',
  command: 'npm test',
  environment: 'development',
});

const run = gateway.runCommand({
  specialistId: 'sales',
  command: 'npm test',
  environment: 'development',
});

console.log(check.decision); // deny
console.log(run.decision); // deny
```

The MCP gateway status also exposes enforcement diagnostics through `enforcementDiagnostics`.

## Current Verification

Current branch verification for the specialist governance and effect guard work:

- `npm test`: 37 suites / 262 tests
- `npm run build`
- `npx tsc --noEmit`

The exact test count can change as coverage is added. Treat this as the current branch verification state, not a permanent compatibility promise.
