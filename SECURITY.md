# Security Policy

## Supported Versions

This project currently supports the current `0.8.x` development line on this branch.

Security fixes will be backported to the latest published release where practical.

## Reporting a Vulnerability

Security contact: Charles Zeller / [charleszeller@gmail.com](mailto:charleszeller@gmail.com)

If you discover a security issue, report it privately before public disclosure.
Please include the affected version, a short summary, reproduction steps, and any relevant logs or indicators.
Do not open a public issue with exploit details.
If a GitHub Security Advisory process is available for the repository, use that.
Otherwise, email the security contact above.

We aim to acknowledge good-faith reports promptly and will coordinate disclosure before any public write-up.

## Security Model

`SafeLoop` provides cooperative governance primitives for local AI agent work:

- policy gating before guarded execution
- command guard and circuit breaker controls
- specialist permission evaluation
- effect guard coverage diagnostics
- local event ledgers for review and auditability
- monitor/dashboard visibility for human review

It is not a sandbox and is not a complete security boundary.

SafeLoop can govern actions routed through its command guard, MCP gateway tools, scenario loop, `guardEffect`, or registered adapters. Actions that bypass those paths bypass SafeLoop.

## What This Package Does Not Protect Against

This package does not replace:
- tool sandboxing
- credential isolation
- network egress controls
- file-system permissions
- prompt injection defenses
- manual diff review
- least-privilege access

## Recommended Use

- Run local-first whenever possible.
- Use least privilege for tools and credentials.
- Do not run agents with production credentials.
- Sandbox external tools and networked actions.
- Avoid exposing `.env`, SSH keys, npm tokens, GitHub tokens, or API keys in prompts, logs, or ledger entries.
- Require human approval for high-risk actions.
- Review `git diff` before commit or push.
- Treat demos and simulations as proof of control logic, not as a security boundary.
