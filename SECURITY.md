# Security Policy

## Supported Versions

This project currently supports the v0.6.x line.

Security fixes will be backported to the latest published v0.6 release where practical.

## Reporting a Vulnerability

Security contact: Charles Zeller / [charleszeller@gmail.com](mailto:charleszeller@gmail.com)

If you discover a security issue, report it privately before public disclosure.
Please include the affected version, a short summary, reproduction steps, and any relevant logs or indicators.
Do not open a public issue with exploit details.
If a GitHub Security Advisory process is available for the repository, use that.
Otherwise, email the security contact above.

We aim to acknowledge good-faith reports promptly and will coordinate disclosure before any public write-up.

## Security Model

`Safeloop` provides governance primitives for local AI agent loops:
- policy gating before execution
- circuit breaking during execution
- action ledgers for review and auditability
- markdown reports for human review

It is not a sandbox and is not a complete security boundary.

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
- Treat the live simulation harness as proof of control logic, not as a security boundary.
