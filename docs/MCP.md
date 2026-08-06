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

## Command Gateway

Run the gateway demo:

```bash
npx ts-node examples/safeloop-mcp-gateway-demo.ts
```

The gateway applies SafeLoop command policy. Denied and approval-required commands do not execute.

When `specialistId` is supplied, `safeloop.checkCommand` and `safeloop.runCommand` use the same specialist permission evaluation. For example, `sales` cannot use `terminal` in either preflight or execution.

## Enforcement Diagnostics

`safeloop.status` includes:

- available tools
- base directory
- ledger path
- cooperative enforcement boundary
- registered effect adapters
- expected effect adapters
- known effect coverage gaps

## Boundary

MCP hosts must choose SafeLoop tools when governance is required. If a host also exposes raw shell, file, deployment, messaging, or API tools and an agent uses those directly, SafeLoop cannot govern those actions.
