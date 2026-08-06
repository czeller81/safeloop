# K-12 Offline RAG Policy Template

Use this as a starting point for `.safeloop/policy.md`.

## Allowed

- Query the local vector database.
- Read approved district documentation from local storage.
- Draft internal staff summaries with local citations.
- Run local validation commands such as `npm test`.

## Requires Human Review

- Any network access, including `curl`, `Invoke-WebRequest`, `wget`, `scp`, `sftp`, and `rsync`.
- Bulk copy, sync, or export commands such as `robocopy` and `xcopy`.
- Destructive file changes such as `Remove-Item` and `del`.
- Disk, NAS, SAN, or removable-media changes such as `format`, `diskpart`, `net use`, and `New-SmbMapping`.
- Model, package, or runtime updates such as `docker pull`, `npm install`, and `pip install`.
- Publishing or deployment commands such as `git push`, `deploy`, and `npm publish`.

## Blocked

- Disabling SafeLoop or stopping its guard process, including `Disable-SafeLoop` and `Stop-Process safeloop`.
- Deleting SafeLoop audit data, including `rm .safeloop` and `Remove-Item .safeloop`.
- Known destructive commands such as `rm -rf`, `sudo rm`, `del /s`, `Remove-Item -Recurse -Force`, and `DROP TABLE`.

## Data Rules

- Student PII must stay local unless a records officer approves export.
- Generated answers should cite local district sources when used for policy or records work.
- When evidence is unavailable, the agent should say so instead of relying on general model knowledge.
