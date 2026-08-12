# Security Policy

## Supported Versions

This project currently supports the current `0.2.x` runtime-governance release line on this branch. Security fixes will be made on top of the immutable `v0.2.0` release history where practical; the `v0.2.0` tag itself remains bound to its audited release commit.

## Reporting a Vulnerability

Security contact: Charles Zeller / [charleszeller@gmail.com](mailto:charleszeller@gmail.com)

If you discover a security issue, report it privately before public disclosure. Please include the affected version, a short summary, reproduction steps, and any relevant logs or indicators. Do not open a public issue with exploit details. If a GitHub Security Advisory process is available for the repository, use that. Otherwise, email the security contact above.

We aim to acknowledge good-faith reports promptly and will coordinate disclosure before any public write-up.

## Security Model

`SafeLoop` provides cooperative local runtime governance for autonomous AI agent work routed through SafeLoop-managed paths:

- deterministic policy gating before guarded execution
- bound approvals and one-time execution permits
- managed shell, filesystem, git, HTTP, and MCP execution paths where configured
- circuit breaker and budget admission controls
- evidence provenance and local event ledgers for review and auditability
- governed memory verification before durable persistence
- monitor/dashboard visibility over runtime and ledger evidence

SafeLoop is not a sandbox and is not a complete security boundary. It does not provide universal OS interception, kernel containment, arbitrary process isolation, EDR, firewalling, or universal syscall control.

SafeLoop can govern actions routed through its command guard, MCP gateway tools, MCP stdio server, scenario loop, `guardEffect`, runtime SDK/API surfaces, memory governance API, or registered adapters. Actions that bypass those paths bypass SafeLoop.

For K-12 or other regulated local deployments, SafeLoop should be treated as one governance layer inside a broader controlled environment. It can help record and mediate actions that are routed through SafeLoop, but it is not by itself a FERPA, COPPA, CIPA, NIST, or district policy compliance program.

## What This Package Does Not Protect Against

This package does not replace:

- OS or container sandboxing
- credential isolation
- network egress controls
- file-system permissions
- hosted IAM or enterprise identity proof
- prompt injection defenses
- manual diff review
- least-privilege access
- controls over private tools that do not call SafeLoop
- controls over external/native memory stores that do not call SafeLoop before persistence

## Known Boundary Limits

- Same-UID local processes may read credential files if the host account is already compromised.
- Userspace filesystem checks narrow but do not eliminate every sub-syscall timing race.
- Dashboard views observe runtime/ledger evidence; they do not independently enforce policy.
- Provider-backed Hermes model-in-loop behavior and Hermes native memory behavior are not certified unless a specific adapter proof says so.

## Recommended Use

- Run local-first whenever possible.
- Use least privilege for tools and credentials.
- Do not run agents with production credentials.
- Sandbox external tools and networked actions.
- Avoid exposing `.env`, SSH keys, npm tokens, GitHub tokens, or API keys in prompts, logs, or ledger entries.
- Require human approval for high-risk actions.
- Route consequential shell, filesystem, git, HTTP, MCP, publishing, messaging, deployment, export, delete, and memory-write paths through SafeLoop-managed surfaces.
- Review `git diff` before commit or push.
- Treat demos and simulations as proof of control logic, not as an OS security boundary.
- For student data, keep deployments local by default, minimize ingested records, restrict access to authorized staff, test backup/restore, and pair SafeLoop with district identity, retention, endpoint, and network controls.