# Governance Profiles

Profiles are **data**, not code. They live as JSON in `profiles/` and are
evaluated by a generic matcher in `src/runtime/profiles.ts`. Executors contain
no profile knowledge; adding a profile must never require touching one.

```bash
safeloop profiles                      # list
safeloop profiles --profile coding     # full rule set and declared paths
safeloop profiles --profile coding --json
```

## Evaluation

Deterministic, in three steps:

1. Compute structural facts about the canonical action.
2. Select every rule whose declared conditions all hold (AND within a rule).
3. Take the **most severe** disposition among matching rules.

Severity is a total order, so rule file order can never change an outcome:

```
ALLOW < ALLOW_WITH_WARNING < PAUSE < REQUIRE_APPROVAL < DENY < STOP_AGENT
```

The profile result is then combined with the risk engine's result, again
most-severe-wins. Neither can loosen the other.

## Facts a rule can match

| Fact | Values |
| --- | --- |
| `action_kinds` | `shell`, `filesystem`, `git`, `http`, `mcp`, `memory`, `delegation`, `custom` |
| `operations` | exact canonical operation, e.g. `force_push`, `delete` |
| `tools`, `methods` | exact canonical values |
| `workspace` | `inside`, `outside`, `unknown` |
| `sensitive_path` | credential/secret/key locations |
| `governance_config` | paths that would change SafeLoop's own behaviour |
| `destructive` | derived per family; shell uses pattern detection |
| `target_pattern` | regex over target/resource |
| `argument_pattern` | regex over operation + tool + canonical arguments |
| `ignore_case` | applies `i` to the patterns above |

`ignore_case` is an explicit field because JavaScript has no inline `(?i)`
group; embedding one in a pattern throws at profile load.

`unknown` workspace relation is a first-class value, and profiles give it the
stricter treatment. A path SafeLoop cannot classify is never given the benefit
of the doubt.

## Shipped profiles

### `coding`
Default `ALLOW`. Reads and in-workspace writes flow. Commits, pushes, remote
changes, and writes outside the workspace are held. Force push, destructive
operations outside the workspace, credential paths, and governance-config writes
are refused. Package installs warn; deploy commands are held. Memory:
`allow_with_ttl`, minimum confidence 0.7.

### `research`
Default `ALLOW_WITH_WARNING`. Reads — including public HTTP — flow freely.
Anything that writes outside the workspace, publishes, or mutates external state
is held. Force push refused. Memory: `require_review`, minimum confidence 0.75.

### `assistant`
Default `ALLOW_WITH_WARNING`. Shell is **denied** entirely; repository mutation
is denied. Reads outside the workspace are held. External communication is held.
Delegation disabled. Memory: `allow_with_ttl`, minimum confidence 0.75.

### `strict-local`
Default `REQUIRE_APPROVAL` — the interesting default: anything not explicitly
allowed needs a human. Only in-workspace reads are ungated. All network I/O is
denied. Nothing is published. Destructive operations and delegation refused.
Memory: `require_review`, minimum confidence 0.9.

## Coding profile reference

| Action | Disposition |
| --- | --- |
| File read (in workspace) | ALLOW |
| File read (outside) | ALLOW_WITH_WARNING |
| Write inside workspace | ALLOW |
| Write outside workspace | REQUIRE_APPROVAL |
| Write, workspace unknown | REQUIRE_APPROVAL |
| Destructive inside workspace | ALLOW_WITH_WARNING |
| Destructive outside workspace | DENY |
| Sensitive credential paths | DENY |
| SafeLoop governance config | DENY |
| Git read (status/diff/log/show) | ALLOW |
| Git add | ALLOW |
| Git commit | REQUIRE_APPROVAL |
| Git push | REQUIRE_APPROVAL |
| Git force push | DENY |
| Git remote mutation | REQUIRE_APPROVAL |
| Git reset --hard / clean / branch delete | REQUIRE_APPROVAL |
| Destructive shell / sudo | DENY |
| Package install | ALLOW_WITH_WARNING |
| Deploy commands | REQUIRE_APPROVAL |
| Public HTTP GET | ALLOW_WITH_WARNING |
| External mutation / authenticated mutation | REQUIRE_APPROVAL |
| Credential export | DENY |
| MCP call | ALLOW_WITH_WARNING |
| Consequential MCP call | REQUIRE_APPROVAL |
| Governance bypass instruction | DENY |
| Memory persistence | governed (`allow_with_ttl`) |

## Budgets

Each profile declares ceilings for actions, runtime, tokens, cost, and retries.
These are admission control at the executor, not risk inputs. Delegated sessions
are capped at the parent's *remaining* budget.

## Managed path declarations

Each profile declares MANAGED / UNMANAGED / DISABLED per path, with
`consequential` and `certification_impact` flags. An enabled consequential
UNMANAGED path prevents full-profile certification. See
`docs/MANAGED_EXECUTION.md`.

## Writing a profile

Add `profiles/<id>.profile.json`. It is validated on load: unique rule ids,
valid dispositions, and compilable regular expressions. A malformed profile
fails loudly at startup rather than silently matching nothing.

Keep rules structural. Prefer `operations: ["force_push"]` over a regex hunting
for the word "force" — the whole point of the canonical action model is that
policy does not have to parse English.
