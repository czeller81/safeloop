# SafeLoop MCP

SafeLoop exposes cooperative command governance through a local MCP command gateway and a stdio MCP server.

## Tools

- `safeloop.checkCommand`: preflight a shell command without executing it.
- `safeloop.runCommand`: execute a shell command through SafeLoop CommandGuard.
- `safeloop.recordActivity`: record an audit-only activity event.
- `safeloop.status`: return gateway status, ledger path, available tools, and enforcement diagnostics.

## Stdio Server

Start the local stdio server:

```bash
npx safeloop mcp serve
```

Stdout is reserved for JSON-RPC protocol responses. Server logs go to stderr so MCP stdio behavior remains clean.

For local source development, the example entrypoint still works:

```bash
npx ts-node examples/safeloop-mcp-stdio-server.ts
```

Example host configuration shape:

```json
{
  "mcpServers": {
    "safeloop": {
      "command": "npx",
      "args": ["safeloop", "mcp", "serve"]
    }
  }
}
```

## Doctor

Run the compatibility doctor:

```bash
npx safeloop mcp doctor
npx safeloop mcp doctor --host hermes
```

The doctor checks:

- Node.js and npm availability
- built CLI readiness
- MCP `initialize`
- MCP `tools/list`
- `safeloop.status`
- dangerous-command preflight denial
- Hermes config location when `--host hermes` is supplied

Use JSON output for scripts:

```bash
npx safeloop mcp doctor --host hermes --json
```

## Hermes Config

Print a ready-to-paste Hermes config block:

```bash
npx safeloop mcp print-config hermes
```

Built-mode output points Hermes at `dist/cli.js`, so run `npm run build` first.

For local source development:

```bash
npx safeloop mcp print-config hermes --mode source
```

For package usage:

```bash
npx safeloop mcp print-config hermes --mode npx
```

Hermes prefixes MCP tool names with the configured server name. If the server is named `safeloop`, tools may appear in Hermes as names derived from `safeloop.checkCommand`, `safeloop.runCommand`, `safeloop.recordActivity`, and `safeloop.status`.

## MCPorter Troubleshooting

MCPorter is useful for inspecting whether Hermes or another MCP host can see SafeLoop clearly:

```bash
npx safeloop mcp mcporter
```

This prints commands such as:

```bash
npx mcporter list
npx mcporter list safeloop --schema
npx mcporter call safeloop.safeloop.status
npx mcporter call safeloop.safeloop.checkCommand command:"rm -rf ."
```

SafeLoop does not require MCPorter at runtime. MCPorter is a good diagnostic bridge when host configuration is unclear.

In locked-down appliance deployments, use MCPorter during setup only. Production Hermes configuration should call the SafeLoop stdio server directly and should avoid exposing unmanaged raw command tools to agents that are expected to stay inside SafeLoop governance.

## Command Gateway

Run the gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

The gateway applies SafeLoop command policy. Denied and approval-required commands do not execute.

When `specialistId` is supplied, `safeloop.checkCommand` and `safeloop.runCommand` use the same specialist permission evaluation. For example, `sales` cannot use `terminal` in either preflight or execution.

## Runtime Governance

The MCP gateway is the preferred enforcement path for shell commands. Custom MCP tools that perform non-shell effects should call the runtime governance API before execution:

```typescript
import { evaluateRuntimePolicy } from 'safeloop';

const decision = evaluateRuntimePolicy({
  agentId: 'mcp-agent',
  action: 'send external message',
  tool: 'district.email',
  target: 'external-recipient',
  context: {
    hasHumanApproval: false,
    scenario: {
      scenarioId: 'district-local-ai',
      requireApprovalFor: ['send external', 'email'],
    },
  },
});

if (!decision.allowed) {
  // Return a held/denied tool result and do not call the downstream tool.
}
```

This preserves MCP stdio behavior while making consequential custom tools participate in SafeLoop decisions, circuit breakers, and ledger evidence.

## Enforcement Diagnostics

`safeloop.status` includes:

- available tools
- base directory
- ledger path
- cooperative enforcement boundary
- registered effect adapters
- expected effect adapters
- known effect coverage gaps

## Consequential Action Classification

SafeLoop decides whether a downstream MCP call is consequential from the *action name*, not from substring containment. The classifier lives in `src/runtime/mcpActionClassifier.ts` and is exercised by the `mcp.consequential` profile rule through the `mcp_consequential` action fact.

### Order of operations

```text
original tool/operation string
  -> segment lexical boundaries   (case still present)
  -> lowercase each token
  -> classify against a closed vocabulary
```

Segmentation runs on the original proposal string, inside `canonicalizeAction`, because `tool` and `operation` are lowercased for fingerprint stability and that collapses `deleteRepository` into `deleterepository`. The resulting `mcp_consequential` flag is carried on the canonical action and is deliberately **excluded from `fingerprintBindingSet`**, so classification changes no action fingerprint, permit, or approval token.

### Segmentation

A single linear pass splits on non-alphanumerics and on three character transitions:

| Transition | Example |
| --- | --- |
| lowercase or digit → uppercase | `deleteRepository` → `delete` \| `Repository` |
| uppercase run → uppercase+lowercase (acronym) | `deleteAPIKey` → `delete` \| `API` \| `Key` |
| any letter → digit | `delete2FADevice` → `delete` \| `2` \| `FA` \| `Device` |

The letter→digit rule deliberately covers **lowercase** letters, not only uppercase. Restricting it to uppercase meant a digit immediately following a lowercase verb was absorbed into it — `delete2FADevice` segmented as `delete2` \| `fa` \| `device`, losing the action verb entirely. `deleteUser2FA` was unaffected only because the `U` split first, which is why an earlier digit corpus passed while the verb-adjacent digit shape did not.

| Input | Tokens |
| --- | --- |
| `deleteRepository` | `delete`, `repository` |
| `DropDatabase` | `drop`, `database` |
| `github.delete_repo` | `github`, `delete`, `repo` |
| `deleteAPIKey` | `delete`, `api`, `key` |
| `delete2FADevice` | `delete`, `2`, `fa`, `device` |
| `dropDB2Table` | `drop`, `db`, `2`, `table` |
| `weather_delete_status` | `weather`, `delete`, `status` |

Digits are not semantically parsed beyond boundary preservation: `2FA` becomes `2` and `fa` rather than a single token. That is sufficient, because classification only needs the action verb to survive as its own token. A digit never implies destruction on its own — `listUsers2`, `getV2Config`, and `fetchS3Metadata` are all benign.

### Action grammar

Matching is **exact token equality** against a closed vocabulary. There is no stemming and no prefix matching, so `deletion`, `deleted`, `removal`, `droppable`, and `undelete` are non-actions by construction rather than by a suffix blocklist.

A destructive verb counts only in an action position: first token, second token, last token, or immediately after a destructive qualifier (`hard`, `soft`, `force`, `permanent`, `bulk`, `mass`, `recursive`, `cascade`).

The classifier distinguishes command roles from reporting roles. A primary command verb can act on a descriptor-like target when that target is a common resource noun: `deleteStatus`, `deleteUserStatus`, `destroyState`, `purgeHistory`, `disableAccountState`, and `resetCredentialStatus` are consequential because the first token is the action and the final descriptor-like token is the object. The separator-delimited form `delete_status` is treated conservatively the same way: it may mean either "delete the status resource" or "status of a delete operation", and SafeLoop chooses approval for destructive-looking command forms when name-only evidence is ambiguous.

Reporting and morphology still veto classification. `deletionStatus`, `deletedItemStatus`, `removalHistory`, `destroyedState`, `weather_delete_status`, `drop_down_menu`, `force_multiplier`, `push_notification_status`, and `remove_listener` remain benign because they are noun/adjective/reporting forms or because the destructive token is not in primary command position.

### Evidence precedence

A consequential tool name or a consequential string argument value is independently sufficient. Two signals do not escalate further than one: the `mcp.consequential` rule raises a single `REQUIRE_APPROVAL` either way.

### Ambiguous names

Names are judged on what they say, and SafeLoop does not invent certainty:

| Name | Result | Reason |
| --- | --- | --- |
| `softDelete`, `dropConnection`, `resetPassword`, `disableAccount`, `deleteConfig` | consequential | A vocabulary verb acts on a real object. |
| `deleteStatus`, `deleteUserStatus`, `destroyState`, `purgeHistory`, `resetCredentialStatus` | consequential | A primary command verb acts on a descriptor-like target object. |
| `delete_status` | consequential | Ambiguous verb-object separator form; SafeLoop chooses conservative approval. |
| `archiveUser`, `clearCache` | benign | `archive` and `clear` are not in the declared vocabulary. |
| `deletionStatus`, `removedItems`, `removalHistory`, `removeListener` | benign | Morphology/reporting/listener surfaces are not command-shaped destructive actions. |

Where a name is genuinely ambiguous, SafeLoop prefers conservative approval for command-shaped destructive forms and benign classification for reporting-shaped noun/adjective forms. Arguments, an explicit profile rule, or the managed-path configuration remain available to gate domain-specific names, and every MCP call is still governed and recorded by `mcp.call`.

### Limitations

- **The vocabulary is ASCII.** A Cyrillic homoglyph (`deletе...`) or full-width form (`Ｄｅｌｅｔｅ...`) is not recognized as a destructive verb. SafeLoop performs no Unicode confusable normalization and makes no homoglyph-resistance claim. Such calls remain governed by `mcp.call` rather than silently allowed.
- The vocabulary is closed. A destructive verb outside it (for example a domain-specific one) is not recognized by name; gate it with an explicit profile rule.
- Classification reads names and string argument values. It does not inspect downstream server behavior, so a benignly named tool that destroys data is bounded by managed-path configuration and approval policy, not by its name.
- **The descriptor grammar is conservative where name-only evidence remains ambiguous.** `dropDownOptions` is still classified consequential because `options` is not a reporting descriptor and broadening that veto would reopen target-object bypasses. Reporting-shaped `purgeScheduleView` and `truncatePreviewLength` are benign, while direct target commands such as `dropView`, `deleteView`, and `dropMaterializedView` remain consequential. Over-gating yields `REQUIRE_APPROVAL`, which an operator can clear; under-gating would silently permit destruction. Asserted in tests in both directions.

## Boundary

MCP hosts must choose SafeLoop tools when governance is required. If a host also exposes raw shell, file, deployment, messaging, or API tools and an agent uses those directly, SafeLoop cannot govern those actions.
