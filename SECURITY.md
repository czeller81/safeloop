# Security Policy

## Supported Versions

This project currently supports the v0.1.x line.

Security fixes will be backported to the latest published v0.1 release where practical.

## Reporting a Vulnerability

If you discover a security issue, report it privately to the maintainers before public disclosure.

Do not open a public issue with exploit details.
If a GitHub Security Advisory process is available for the repository, use that.
Otherwise, contact the maintainer through the private channel established for the project.

## Security Model

`agent-circuit-breaker` provides governance primitives for local AI agent loops:
- policy gating before execution
- circuit breaking during execution
- action ledgers for review and auditability
- markdown reports for human review

It is not a sandbox and does not enforce system-level isolation.

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
- Avoid production credentials in local agent loops.
- Require human approval for high-risk actions.
- Review `git diff` before commit or push.
- Treat the live simulation harness as proof of control logic, not as a security boundary.
